variable "env" {
  type = string
}

variable "pool_name" {
  type = string
}

variable "user_pool_id" {
  type = string
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

resource "aws_iam_role_policy" "cognito_trigger_sns" {
  name = "sns-publish"
  role = aws_iam_role.cognito_trigger.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sns:Publish"]
      Resource = "*"
    }]
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

# ─── Create Auth Challenge (generate + send OTP via SNS) ────────────────────

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
}

data "archive_file" "create_auth" {
  type        = "zip"
  output_path = "${path.module}/dist/create-auth.zip"

  source {
    content  = <<-JS
      const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
      const sns = new SNSClient({ region: process.env.AWS_REGION || "us-east-1" });

      exports.handler = async (event) => {
        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const phone = event.request.userAttributes.phone_number;

        await sns.send(new PublishCommand({
          PhoneNumber: phone,
          Message: "Your Area Code verification code is: " + otp,
          MessageAttributes: {
            "AWS.SNS.SMS.SMSType": {
              DataType: "String",
              StringValue: "Transactional",
            },
          },
        }));

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
