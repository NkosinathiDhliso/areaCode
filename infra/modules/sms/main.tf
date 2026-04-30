variable "env" {
  type = string
}

variable "sender_id" {
  type    = string
  default = "AREACODE"
}

# ─── Configuration Set (delivery monitoring) ─────────────────────────────────
# This is the only End User Messaging SMS resource supported by the
# Terraform AWS provider (as of v5.100). Event destinations and Protect
# Configurations must be created via AWS CLI — see scripts/setup-sms.sh.

resource "aws_pinpointsmsvoicev2_configuration_set" "otp" {
  name                 = "area-code-${var.env}-otp"
  default_message_type = "TRANSACTIONAL"
  default_sender_id    = var.sender_id

  tags = {
    Environment = var.env
    Purpose     = "OTP delivery monitoring"
  }
}

# ─── CloudWatch log group for SMS delivery events ───────────────────────────
# The event destination linking this log group to the configuration set
# is created by scripts/setup-sms.sh (not supported in Terraform).

resource "aws_cloudwatch_log_group" "sms_events" {
  name              = "/area-code/${var.env}/sms-events"
  retention_in_days = 30

  tags = {
    Environment = var.env
    Purpose     = "SMS delivery event logs"
  }
}

# ─── IAM role for SMS → CloudWatch log delivery ─────────────────────────────

resource "aws_iam_role" "sms_cloudwatch" {
  name = "area-code-${var.env}-sms-cloudwatch"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "sms-voice.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "sms_cloudwatch" {
  name = "cloudwatch-logs"
  role = aws_iam_role.sms_cloudwatch.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ]
      Resource = "${aws_cloudwatch_log_group.sms_events.arn}:*"
    }]
  })
}

# ─── Outputs ─────────────────────────────────────────────────────────────────

output "configuration_set_name" {
  value = aws_pinpointsmsvoicev2_configuration_set.otp.name
}

output "configuration_set_arn" {
  value = aws_pinpointsmsvoicev2_configuration_set.otp.arn
}

output "sms_log_group_name" {
  value = aws_cloudwatch_log_group.sms_events.name
}

output "sms_log_group_arn" {
  value = aws_cloudwatch_log_group.sms_events.arn
}

output "sms_cloudwatch_role_arn" {
  value = aws_iam_role.sms_cloudwatch.arn
}
