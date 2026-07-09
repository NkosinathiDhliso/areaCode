################################################################################
# CloudWatch RUM — Real User Monitoring for the Area Code SPAs.
#
# The single frontend error/performance monitoring path (we cover compute with
# AWS credits, so keeping observability inside CloudWatch avoids a second bill).
#
# Cost model (us-east-1, May 2026):
#   - $1.00 per 100,000 events (pageviews + JS errors + custom events).
#   - Scales to zero when idle (no provisioned capacity).
#   - For pre-launch / pilot we expect well under 100k events / month / domain,
#     i.e. cents per month total. The $100 prod budget alarm covers any blow-up.
#
# Privacy / cookies:
#   - We deliberately set `cw_log_enabled = true` (write to CloudWatch Logs only)
#     and rely on the SDK's `allowCookies = false` runtime flag (configured in
#     apps/*/src/lib/rum.ts) so no analytics cookies are dropped.
#   - This keeps us in "strictly necessary storage only" territory under POPIA,
#     so no cookie banner is required. See `apps/web/src/screens/PrivacyPolicyScreen.tsx`
#     §9 for the user-facing disclosure.
#
# Identity:
#   - Each app monitor is paired with a Cognito *Identity* Pool (not the
#     User Pools used for sign-in). Identity Pools mint short-lived,
#     unauthenticated AWS credentials so the browser SDK can sign
#     `rum:PutRumEvents` calls. They are free.
################################################################################

variable "env" {
  type        = string
  description = "Environment name (dev, prod)."
}

variable "monitors" {
  description = <<-EOT
    Map of app monitors to create. Key is a short logical name (web, business, ...);
    used for resource naming and as the monitor name suffix.
  EOT
  type = map(object({
    domain              = string       # e.g. "areacode.co.za"
    additional_domains  = list(string) # e.g. ["www.areacode.co.za"]
    session_sample_rate = number       # 0.0–1.0, fraction of sessions to record
  }))
}

# ─── Cognito Identity Pool (one per app monitor) ─────────────────────────────
# Unauthenticated identities only — the browser never signs in here. Pool exists
# solely to vend temporary credentials scoped to rum:PutRumEvents.

resource "aws_cognito_identity_pool" "rum" {
  for_each = var.monitors

  identity_pool_name               = "area-code-${var.env}-rum-${each.key}"
  allow_unauthenticated_identities = true
  allow_classic_flow               = false
}

# ─── IAM role assumed by the unauthenticated identity ────────────────────────

data "aws_iam_policy_document" "rum_assume" {
  for_each = var.monitors

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    principals {
      type        = "Federated"
      identifiers = ["cognito-identity.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "cognito-identity.amazonaws.com:aud"
      values   = [aws_cognito_identity_pool.rum[each.key].id]
    }

    condition {
      test     = "ForAnyValue:StringLike"
      variable = "cognito-identity.amazonaws.com:amr"
      values   = ["unauthenticated"]
    }
  }
}

resource "aws_iam_role" "rum_unauth" {
  for_each = var.monitors

  name               = "area-code-${var.env}-rum-${each.key}-unauth"
  assume_role_policy = data.aws_iam_policy_document.rum_assume[each.key].json
}

resource "aws_iam_role_policy" "rum_put_events" {
  for_each = var.monitors

  name = "rum-put-events"
  role = aws_iam_role.rum_unauth[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["rum:PutRumEvents"]
      # Scoped to this monitor only.
      Resource = aws_rum_app_monitor.this[each.key].arn
    }]
  })
}

# Attach the unauth role to the identity pool.
resource "aws_cognito_identity_pool_roles_attachment" "rum" {
  for_each = var.monitors

  identity_pool_id = aws_cognito_identity_pool.rum[each.key].id

  roles = {
    unauthenticated = aws_iam_role.rum_unauth[each.key].arn
  }
}

# ─── App monitor itself ──────────────────────────────────────────────────────

resource "aws_rum_app_monitor" "this" {
  for_each = var.monitors

  name           = "area-code-${var.env}-${each.key}"
  domain         = each.value.domain
  cw_log_enabled = true

  app_monitor_configuration {
    allow_cookies       = false # POPIA-friendly; no analytics cookies.
    enable_xray         = false # Lambda already has X-Ray; we don't need browser-side traces.
    session_sample_rate = each.value.session_sample_rate
    telemetries         = ["errors", "performance", "http"]

    # Identity pool is wired post-create via the resource below; not all
    # provider versions accept `identity_pool_id` inline on the monitor.
    identity_pool_id = aws_cognito_identity_pool.rum[each.key].id
  }
}

# ─── Outputs ─────────────────────────────────────────────────────────────────
# These get consumed by the Amplify env-var update script so the SPAs can
# bootstrap the RUM SDK at runtime.

output "monitors" {
  description = "Map of monitor name → frontend SDK config."
  value = {
    for k, m in aws_rum_app_monitor.this :
    k => {
      app_monitor_id   = m.app_monitor_id
      identity_pool_id = aws_cognito_identity_pool.rum[k].id
      region           = data.aws_region.current.name
    }
  }
}

data "aws_region" "current" {}
