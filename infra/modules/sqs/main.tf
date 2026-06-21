variable "env" {
  type = string
}

variable "queue_name" {
  type = string
}

variable "visibility_timeout" {
  type    = number
  default = 60
}

variable "message_retention_seconds" {
  type    = number
  default = 345600 # 4 days
}

variable "max_receive_count" {
  type    = number
  default = 3
}

variable "lambda_function_arn" {
  type    = string
  default = ""
}

# Whether to create the SQS -> Lambda event source mapping. This must be a
# plan-time-known boolean: deriving `count` from `lambda_function_arn` breaks
# `terraform plan` whenever that ARN belongs to a Lambda created in the same
# apply (the ARN is "known after apply", so Terraform cannot resolve `count`).
# Callers that wire a Lambda pass `enable_lambda_mapping = true` alongside the
# ARN; queues with no consumer leave it at the default `false`.
variable "enable_lambda_mapping" {
  type    = bool
  default = false
}

# --- Dead letter queue ---
resource "aws_sqs_queue" "dlq" {
  name                      = "area-code-${var.env}-${var.queue_name}-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Environment = var.env
  }
}

# --- Main queue ---
resource "aws_sqs_queue" "this" {
  name                       = "area-code-${var.env}-${var.queue_name}"
  visibility_timeout_seconds = var.visibility_timeout
  message_retention_seconds  = var.message_retention_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })

  tags = {
    Environment = var.env
  }
}

# --- Lambda event source mapping (if lambda_function_arn provided) ---
resource "aws_lambda_event_source_mapping" "this" {
  count            = var.enable_lambda_mapping ? 1 : 0
  event_source_arn = aws_sqs_queue.this.arn
  function_name    = var.lambda_function_arn
  batch_size       = 1
  enabled          = true
}

output "queue_url" {
  value = aws_sqs_queue.this.url
}

output "queue_arn" {
  value = aws_sqs_queue.this.arn
}

output "dlq_url" {
  value = aws_sqs_queue.dlq.url
}

output "dlq_arn" {
  value = aws_sqs_queue.dlq.arn
}
