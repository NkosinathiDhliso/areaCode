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

variable "username_attributes" {
  type    = list(string)
  default = ["phone_number"]
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

# ─── Hosted UI / federated (Google) sign-in ──────────────────────────────────
variable "enable_hosted_ui" {
  description = "Provision a Hosted UI domain, Google IdP, and OAuth client settings for this pool."
  type        = bool
  default     = false
}

variable "hosted_ui_domain" {
  description = "Cognito Hosted UI domain prefix. Defaults to area-code-<env>-<pool_name>."
  type        = string
  default     = ""
}

variable "callback_urls" {
  type    = list(string)
  default = []
}

variable "logout_urls" {
  type    = list(string)
  default = []
}

variable "oauth_scopes" {
  type    = list(string)
  default = ["aws.cognito.signin.user.admin", "email", "openid", "profile"]
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
  mfa_configuration        = "OFF"

  username_attributes = var.username_attributes

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

  # Hosted UI / OAuth (federated Google + Cognito). Inert when disabled.
  supported_identity_providers         = var.enable_hosted_ui ? ["COGNITO", "Google"] : null
  allowed_oauth_flows                  = var.enable_hosted_ui ? ["code"] : null
  allowed_oauth_scopes                 = var.enable_hosted_ui ? var.oauth_scopes : null
  allowed_oauth_flows_user_pool_client = var.enable_hosted_ui
  callback_urls                        = var.callback_urls
  logout_urls                          = var.logout_urls

  # The client references the "Google" provider name, so the IdP must exist first.
  depends_on = [aws_cognito_identity_provider.google]

  lifecycle {
    # Guardrail: a pool that signs in with email must enable the admin
    # password auth flow, otherwise native email/password signup/login
    # (createEmailPasswordUser + passwordAuth) fails at runtime. This stops a
    # phone-only pool config from silently shipping for an email product.
    precondition {
      condition     = !contains(var.username_attributes, "email") || contains(var.explicit_auth_flows, "ALLOW_ADMIN_USER_PASSWORD_AUTH")
      error_message = "Cognito pool '${var.pool_name}' uses email sign-in but is missing ALLOW_ADMIN_USER_PASSWORD_AUTH in explicit_auth_flows."
    }
  }
}

# ─── Hosted UI domain + Google identity provider ─────────────────────────────
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

  # Cognito auto-populates endpoint URLs (authorize_url, token_url, oidc_issuer,
  # attributes_url, ...) for the "Google" social provider type. They can't be
  # set in config and would otherwise show as a perpetual diff. Only client_id /
  # client_secret / authorize_scopes are managed here.
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
