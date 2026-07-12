variable "pool_name" {
  type = string
}

variable "env" {
  type = string
}

variable "access_token_ttl_hours" {
  type    = number
  default = 1
}

variable "refresh_token_ttl_days" {
  type    = number
  default = 30
}

variable "explicit_auth_flows" {
  type    = list(string)
  default = ["ALLOW_CUSTOM_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
}

variable "custom_attributes" {
  type = list(object({
    name = string
    type = string
  }))
  default = []
}

# Required, no default. The old ["phone_number"] default silently produced
# SMS-era pools (see rules/no-sms-no-phone-auth.md). New pools must be ["email"];
# only the frozen legacy pool instantiations may pass ["phone_number"], because
# username_attributes cannot change on an existing pool without replacing it.
variable "username_attributes" {
  type = list(string)

  validation {
    condition     = var.username_attributes == tolist(["email"]) || var.username_attributes == tolist(["phone_number"])
    error_message = "username_attributes must be [\"email\"] (new pools) or [\"phone_number\"] (frozen legacy pools only)."
  }
}

# MFA mode for the pool. "OFF" (default), "ON" (required), or "OPTIONAL".
# When not "OFF", software-token (TOTP) MFA is enabled. SMS MFA is deliberately
# never configured — see .kiro/steering/no-sms-no-phone-auth.md.
variable "mfa_configuration" {
  type    = string
  default = "OFF"

  validation {
    condition     = contains(["OFF", "ON", "OPTIONAL"], var.mfa_configuration)
    error_message = "mfa_configuration must be one of OFF, ON, OPTIONAL."
  }
}

variable "define_auth_challenge_arn" {
  type    = string
  default = ""
}

variable "create_auth_challenge_arn" {
  type    = string
  default = ""
}

variable "verify_auth_challenge_arn" {
  type    = string
  default = ""
}

# ─── Hosted UI / federated (Google) sign-in ───
# Provisions the Cognito Hosted-UI domain and the Google identity provider for
# this pool. Gated by a plan-time boolean (defaults off) so pools that do not
# use Hosted UI stay untouched. The user-pool *client*'s OAuth attributes are
# deliberately NOT set here: they are Optional+Computed and are managed live
# (consumer/business pools rely on this), so adding them would clobber existing
# callback/identity-provider settings.
variable "enable_hosted_ui" {
  description = "Provision a Hosted UI domain and Google IdP for this pool."
  type        = bool
  default     = false
}

variable "hosted_ui_domain" {
  description = "Cognito Hosted UI domain prefix. Defaults to area-code-<env>-<pool_name>."
  type        = string
  default     = ""
}

variable "google_client_id" {
  type    = string
  default = ""
}

variable "google_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

resource "aws_iam_role" "cognito_sns" {
  name = "area-code-${var.env}-${var.pool_name}-cognito-sns"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "cognito-idp.amazonaws.com" }
      Condition = {
        StringEquals = {
          "sts:ExternalId" = "area-code-${var.env}-${var.pool_name}-sns"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "cognito_sns" {
  name = "sns-publish"
  role = aws_iam_role.cognito_sns.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sns:Publish"]
      Resource = "*"
    }]
  })
}

resource "aws_cognito_user_pool" "this" {
  name = "area-code-${var.env}-${var.pool_name}"

  auto_verified_attributes = var.username_attributes
  mfa_configuration        = var.mfa_configuration

  username_attributes = var.username_attributes

  # TOTP (authenticator app) MFA. Enabled whenever MFA is not OFF. SMS MFA is
  # intentionally omitted (no sms_mfa_configuration block) per the no-SMS rule.
  dynamic "software_token_mfa_configuration" {
    for_each = var.mfa_configuration == "OFF" ? [] : [1]
    content {
      enabled = true
    }
  }

  sms_configuration {
    external_id    = "area-code-${var.env}-${var.pool_name}-sns"
    sns_caller_arn = aws_iam_role.cognito_sns.arn
    sns_region     = "us-east-1"
  }

  password_policy {
    minimum_length    = 8
    require_lowercase = false
    require_numbers   = false
    require_symbols   = false
    require_uppercase = false
  }

  dynamic "schema" {
    for_each = var.custom_attributes
    content {
      name                = schema.value.name
      attribute_data_type = schema.value.type
      mutable             = true
    }
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = contains(var.username_attributes, "email") ? "verified_email" : "verified_phone_number"
      priority = 1
    }
  }

  lifecycle {
    ignore_changes = [schema]
  }

  dynamic "lambda_config" {
    for_each = var.define_auth_challenge_arn != "" ? [1] : []
    content {
      define_auth_challenge          = var.define_auth_challenge_arn
      create_auth_challenge          = var.create_auth_challenge_arn
      verify_auth_challenge_response = var.verify_auth_challenge_arn
    }
  }
}

resource "aws_cognito_user_pool_client" "this" {
  name         = "area-code-${var.env}-${var.pool_name}-client"
  user_pool_id = aws_cognito_user_pool.this.id

  explicit_auth_flows = var.explicit_auth_flows

  access_token_validity  = var.access_token_ttl_hours
  refresh_token_validity = var.refresh_token_ttl_days

  token_validity_units {
    access_token  = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
}

# ─── Hosted UI domain + Google identity provider ───
# Gated on enable_hosted_ui. provider_details has ignore_changes because Cognito
# auto-populates the Google endpoint URLs (authorize_url, token_url, ...) which
# cannot be set in config and would otherwise show a perpetual diff.
resource "aws_cognito_user_pool_domain" "this" {
  count        = var.enable_hosted_ui ? 1 : 0
  domain       = var.hosted_ui_domain != "" ? var.hosted_ui_domain : "area-code-${var.env}-${var.pool_name}"
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_identity_provider" "google" {
  count         = var.enable_hosted_ui ? 1 : 0
  user_pool_id  = aws_cognito_user_pool.this.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid email profile"
  }

  attribute_mapping = {
    email       = "email"
    family_name = "family_name"
    given_name  = "given_name"
    name        = "name"
    username    = "sub"
  }

  lifecycle {
    ignore_changes = [provider_details]
  }
}

output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "client_id" {
  value = aws_cognito_user_pool_client.this.id
}
