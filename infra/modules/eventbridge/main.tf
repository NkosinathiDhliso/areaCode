variable "env" {
  type = string
}

variable "schedules" {
  type = map(object({
    description         = string
    schedule_expression = string
    lambda_arn          = string
    lambda_function_name = string
  }))
  default = {}
}

# --- EventBridge scheduled rules ---
resource "aws_cloudwatch_event_rule" "this" {
  for_each = var.schedules

  name                = "area-code-${var.env}-${each.key}"
  description         = each.value.description
  schedule_expression = each.value.schedule_expression

  tags = {
    Environment = var.env
  }
}

resource "aws_cloudwatch_event_target" "this" {
  for_each = var.schedules

  rule = aws_cloudwatch_event_rule.this[each.key].name
  arn  = each.value.lambda_arn
}

resource "aws_lambda_permission" "eventbridge" {
  for_each = var.schedules

  statement_id  = "AllowEventBridge-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value.lambda_function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.this[each.key].arn
}
