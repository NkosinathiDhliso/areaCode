variable "env" {
  type = string
}

variable "amplify_app_id" {
  type        = string
  description = "The Amplify app ID (from the Amplify console, e.g. d1abc2def3)"
}

variable "domain_name" {
  type        = string
  description = "Root domain name, e.g. areacode.co.za"
}

variable "sub_domains" {
  type = list(object({
    branch_name = string
    prefix      = string # "" for root domain, "www" for www subdomain, etc.
  }))
  description = "List of subdomain mappings"
}

# --- Domain association ---
resource "aws_amplify_domain_association" "this" {
  app_id      = var.amplify_app_id
  domain_name = var.domain_name

  dynamic "sub_domain" {
    for_each = var.sub_domains
    content {
      branch_name = sub_domain.value.branch_name
      prefix      = sub_domain.value.prefix
    }
  }

  wait_for_verification = false
}

# --- Outputs ---
output "domain_association_arn" {
  value = aws_amplify_domain_association.this.arn
}

output "certificate_verification_dns_record" {
  value = aws_amplify_domain_association.this.certificate_verification_dns_record
}
