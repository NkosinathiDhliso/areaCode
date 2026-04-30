variable "env" {
  type = string
}

variable "pool_name" {
  type = string
}

variable "user_pool_id" {
  type = string
}

variable "sms_configuration_set_name" {
  type    = string
  default = ""
}

variable "sms_sender_id" {
  type    = string
  default = "AREACODE"
}

variable "sms_protect_configuration_arn" {
  type    = string
  default = ""
}

# ─── IAM Role for Cognito trigger Lambdas ────────────────────────────────────

resource "aws_iam_role" "cognito_trigger" {
  name = "area-code-${var.env}-${var.pool_name}-cognito-trigger"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "cognito_trigger_logs" {
  role       = aws_iam_role.cognito_trigger.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "cognito_trigger_sms" {
  name = "sms-send"
  role = aws_iam_role.cognito_trigger.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EndUserMessagingSend"
        Effect = "Allow"
        Action = [
          "sms-voice:SendTextMessage",
          "sms-voice:PutMessageFeedback",
        ]
        Resource = "*"
      },
      {
        Sid    = "DynamoDBMessageTracking"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
        ]
        Resource = aws_dynamodb_table.otp_message_tracking.arn
      },
    ]
  })
}

# ─── Define Auth Challenge ───────────────────────────────────────────────────

resource "aws_lambda_function" "define_auth" {
  function_name = "area-code-${var.env}-${var.pool_name}-define-auth"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.cognito_trigger.arn
  architectures = ["arm64"]
  timeout       = 5
  memory_size   = 128

  filename         = data.archive_file.define_auth.output_path
  source_code_hash = data.archive_file.define_auth.output_base64sha256
}

data "archive_file" "define_auth" {
  type        = "zip"
  output_path = "${path.module}/dist/define-auth.zip"

  source {
    content  = <<-JS
      exports.handler = async (event) => {
        const session = event.request.session || [];
        if (session.length === 0) {
          // First call — issue custom challenge (send OTP)
          event.response.issueTokens = false;
          event.response.failAuthentication = false;
          event.response.challengeName = "CUSTOM_CHALLENGE";
        } else {
          const lastChallenge = session[session.length - 1];
          if (lastChallenge.challengeResult === true) {
            // OTP verified — issue tokens
            event.response.issueTokens = true;
            event.response.failAuthentication = false;
          } else if (session.length >= 3) {
            // 3 failed attempts — block
            event.response.issueTokens = false;
            event.response.failAuthentication = true;
          } else {
            // Retry
            event.response.issueTokens = false;
            event.response.failAuthentication = false;
            event.response.challengeName = "CUSTOM_CHALLENGE";
          }
        }
        return event;
      };
    JS
    filename = "index.js"
  }
}

resource "aws_lambda_permission" "define_auth" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.define_auth.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = "arn:aws:cognito-idp:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:userpool/${var.user_pool_id}"
}

# ─── Create Auth Challenge (generate + send OTP via End User Messaging v2) ──

resource "aws_lambda_function" "create_auth" {
  function_name = "area-code-${var.env}-${var.pool_name}-create-auth"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.cognito_trigger.arn
  architectures = ["arm64"]
  timeout       = 10
  memory_size   = 128

  filename         = data.archive_file.create_auth.output_path
  source_code_hash = data.archive_file.create_auth.output_base64sha256

  environment {
    variables = {
      SMS_CONFIGURATION_SET        = var.sms_configuration_set_name
      SMS_SENDER_ID                = var.sms_sender_id
      SMS_PROTECT_CONFIGURATION    = var.sms_protect_configuration_arn
      OTP_TRACKING_TABLE           = aws_dynamodb_table.otp_message_tracking.name
    }
  }
}

data "archive_file" "create_auth" {
  type        = "zip"
  output_path = "${path.module}/dist/create-auth.zip"

  source {
    content  = <<-JS
      const { PinpointSMSVoiceV2Client, SendTextMessageCommand } = require("@aws-sdk/client-pinpoint-sms-voice-v2");
      const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");

      const smsClient = new PinpointSMSVoiceV2Client({ region: process.env.AWS_REGION || "us-east-1" });
      const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });

      exports.handler = async (event) => {
        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const phone = event.request.userAttributes.phone_number;
        const poolName = (process.env.AWS_LAMBDA_FUNCTION_NAME || "").split("-").slice(-3, -2)[0] || "unknown";

        const sendParams = {
          DestinationPhoneNumber: phone,
          MessageBody: "Your Area Code verification code is: " + otp + ". Valid for 5 minutes. Do not share this code.",
          MessageType: "TRANSACTIONAL",
          MessageFeedbackEnabled: true,
          TimeToLive: 300,
        };

        // Apply Sender ID for South Africa (alphanumeric, no registration required)
        if (process.env.SMS_SENDER_ID) {
          sendParams.OriginationIdentity = process.env.SMS_SENDER_ID;
        }

        // Apply Configuration Set for delivery monitoring
        if (process.env.SMS_CONFIGURATION_SET) {
          sendParams.ConfigurationSetName = process.env.SMS_CONFIGURATION_SET;
        }

        // Apply Protect Configuration for AIT defense
        if (process.env.SMS_PROTECT_CONFIGURATION) {
          sendParams.ProtectConfigurationId = process.env.SMS_PROTECT_CONFIGURATION;
        }

        try {
          const result = await smsClient.send(new SendTextMessageCommand(sendParams));
          const messageId = result.MessageId || "";

          // Store message ID in DynamoDB for feedback tracking
          if (messageId && process.env.OTP_TRACKING_TABLE) {
            const ttl = Math.floor(Date.now() / 1000) + 600; // 10 min TTL
            await ddbClient.send(new PutItemCommand({
              TableName: process.env.OTP_TRACKING_TABLE,
              Item: {
                pk: { S: "otp#" + phone },
                messageId: { S: messageId },
                pool: { S: poolName },
                sentAt: { S: new Date().toISOString() },
                ttl: { N: String(ttl) },
              },
            }));
          }

          console.log("OTP sent", { phone: phone.slice(0, 6) + "****", messageId, pool: poolName });
        } catch (err) {
          console.error("SMS send failed", { error: err.message, phone: phone.slice(0, 6) + "****" });
          throw err;
        }

        event.response.publicChallengeParameters = { phone };
        event.response.privateChallengeParameters = { answer: otp };
        event.response.challengeMetadata = "OTP_CHALLENGE";
        return event;
      };
    JS
    filename = "index.js"
  }
}

resource "aws_lambda_permission" "create_auth" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_auth.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = "arn:aws:cognito-idp:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:userpool/${var.user_pool_id}"
}

# ─── Verify Auth Challenge (check OTP answer) ───────────────────────────────

resource "aws_lambda_function" "verify_auth" {
  function_name = "area-code-${var.env}-${var.pool_name}-verify-auth"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.cognito_trigger.arn
  architectures = ["arm64"]
  timeout       = 5
  memory_size   = 128

  filename         = data.archive_file.verify_auth.output_path
  source_code_hash = data.archive_file.verify_auth.output_base64sha256
}

data "archive_file" "verify_auth" {
  type        = "zip"
  output_path = "${path.module}/dist/verify-auth.zip"

  source {
    content  = <<-JS
      exports.handler = async (event) => {
        const expected = event.request.privateChallengeParameters.answer;
        const answer = event.request.challengeAnswer;
        event.response.answerCorrect = (answer === expected);
        return event;
      };
    JS
    filename = "index.js"
  }
}

resource "aws_lambda_permission" "verify_auth" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.verify_auth.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = "arn:aws:cognito-idp:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:userpool/${var.user_pool_id}"
}

# ─── Data sources ────────────────────────────────────────────────────────────

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# ─── DynamoDB table for OTP message feedback tracking ────────────────────────

resource "aws_dynamodb_table" "otp_message_tracking" {
  name         = "area-code-${var.env}-${var.pool_name}-otp-tracking"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = {
    Purpose = "OTP message feedback tracking for ${var.pool_name} pool"
  }
}

# ─── Outputs ─────────────────────────────────────────────────────────────────

output "define_auth_arn" {
  value = aws_lambda_function.define_auth.arn
}

output "create_auth_arn" {
  value = aws_lambda_function.create_auth.arn
}

output "verify_auth_arn" {
  value = aws_lambda_function.verify_auth.arn
}

output "otp_tracking_table_name" {
  value = aws_dynamodb_table.otp_message_tracking.name
}

output "otp_tracking_table_arn" {
  value = aws_dynamodb_table.otp_message_tracking.arn
}
