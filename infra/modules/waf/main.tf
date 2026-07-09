variable "env" {
  type = string
}

variable "api_gateway_arn" {
  type    = string
  default = ""
}

resource "aws_wafv2_web_acl" "this" {
  name  = "area-code-${var.env}-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "aws-managed-common"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "area-code-${var.env}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-managed-known-bad-inputs"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "area-code-${var.env}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit-checkin"
    priority = 10

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 100
        aggregate_key_type = "IP"

        scope_down_statement {
          byte_match_statement {
            search_string         = "/v1/check-in"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "area-code-${var.env}-rate-checkin"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit-auth"
    priority = 11

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 20
        aggregate_key_type = "IP"

        scope_down_statement {
          byte_match_statement {
            search_string         = "/v1/auth/"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "area-code-${var.env}-rate-auth"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "area-code-${var.env}-waf"
    sampled_requests_enabled   = true
  }
}

# WAF-to-ALB association removed (billing-revenue-integrity R11.3): ALBs are
# forbidden infrastructure (serverless-only.md), so the association could never
# be used. AWS WAFv2 cannot associate with API Gateway v2 HTTP APIs, so edge
# protection for api.areacode.co.za requires a CloudFront distribution, whose
# build is deferred pending founder cost approval (docs/GO_LIVE_AUDIT.md).

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  resource_arn            = aws_wafv2_web_acl.this.arn
}

resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-area-code-${var.env}"
  retention_in_days = 30
}

output "web_acl_arn" {
  value = aws_wafv2_web_acl.this.arn
}
