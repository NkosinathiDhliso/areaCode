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

resource "aws_cognito_user_pool" "this" {
  name = "area-code-${var.env}-${var.pool_name}"

  auto_verified_attributes = ["phone_number"]
  mfa_configuration        = "OFF"

  username_attributes = ["phone_number"]

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
      name     = "verified_phone_number"
      priority = 1
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

output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "client_id" {
  value = aws_cognito_user_pool_client.this.id
}
