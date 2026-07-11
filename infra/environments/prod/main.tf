# SERVERLESS PRODUCTION INFRASTRUCTURE
# Cost-optimized version - removes expensive always-on resources

terraform {
  required_version = ">= 1.5.0"

  backend "s3" {
    bucket         = "area-code-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "area-code-terraform-locks"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "area-code"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

locals {
  env = "prod"
}

variable "spotify_client_id" {
  description = "Spotify OAuth client ID (from developer.spotify.com/dashboard)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "spotify_client_secret" {
  description = "Spotify OAuth client secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "spotify_redirect_uri" {
  description = "Spotify OAuth callback URL — must exactly match what is configured in the Spotify dashboard"
  type        = string
  default     = "https://areacode.co.za/api/v1/streaming/spotify/callback"
}

variable "anonymization_salt" {
  description = "Salt used to anonymize user IDs in venue intelligence reports"
  type        = string
  sensitive   = true
  default     = "report-anonymization-salt-prod"
}

variable "yoco_secret_key" {
  description = "Yoco production secret key for payment processing"
  type        = string
  sensitive   = true
  default     = ""
}

variable "yoco_webhook_secret" {
  description = "Yoco webhook signature verification secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "vapid_public_key" {
  description = "VAPID public key for web push notifications"
  type        = string
  default     = ""
}

variable "vapid_private_key" {
  description = "VAPID private key for web push notifications"
  type        = string
  sensitive   = true
  default     = ""
}

variable "apple_music_team_id" {
  description = "Apple Developer Team ID for Apple Music integration"
  type        = string
  default     = ""
}

variable "apple_music_key_id" {
  description = "Apple Music API key ID"
  type        = string
  default     = ""
}

variable "apple_music_private_key" {
  description = "Apple Music private key (PEM-encoded .p8 content)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "enable_api_custom_domain" {
  description = "Set to true to provision api.areacode.co.za in front of the HTTP API. Requires the areacode.co.za Route53 zone to already exist in this account."
  type        = bool
  default     = true
}

variable "enable_media_custom_domain" {
  description = "Set to true to alias cdn.areacode.co.za onto the media CloudFront distribution (ACM cert + Route53 records). Reuses the areacode.co.za zone, so it requires enable_api_custom_domain."
  type        = bool
  default     = true
}

locals {
  # Media CDN custom domain. Gated on the API-domain flag because both share the
  # single areacode.co.za Route53 zone data source below.
  media_cdn_domain     = "cdn.areacode.co.za"
  media_domain_enabled = var.enable_api_custom_domain && var.enable_media_custom_domain
}

variable "alerts_email" {
  description = "Email address that receives CloudWatch alarm notifications via the alerts SNS topic and budget alerts."
  type        = string
  default     = "alerts@areacode.co.za"
}

# --- Data sources for secrets ---
data "aws_secretsmanager_secret" "qr_hmac" {
  name = "area-code/${local.env}/qr-hmac-secret"
}

data "aws_secretsmanager_secret_version" "qr_hmac" {
  secret_id = data.aws_secretsmanager_secret.qr_hmac.id
}

# Google OAuth credentials for the Cognito Hosted-UI Google identity providers
# (staff + admin pools). Stored in Secrets Manager as JSON
# {"client_id": "...", "client_secret": "..."} so the secret never lives in code.
data "aws_secretsmanager_secret" "google_oauth" {
  name = "area-code/${local.env}/google-oauth"
}

data "aws_secretsmanager_secret_version" "google_oauth" {
  secret_id = data.aws_secretsmanager_secret.google_oauth.id
}

locals {
  google_oauth = jsondecode(data.aws_secretsmanager_secret_version.google_oauth.secret_string)
}

# --- VPC / Networking ---
module "vpc" {
  source             = "../../modules/vpc"
  env                = local.env
  enable_nat_gateway = false
}

# --- Cognito pools (4 separate pools) ---
# Email/password is the supported live auth path (phone OTP is dead, returns
# 410). The backend signs in via AdminInitiateAuth ADMIN_USER_PASSWORD_AUTH, so
# every pool's app client must enable that flow. Codified here to match what is
# live (the consumer client was enabled by hand) and to stop a future apply from
# stripping it and breaking sign-in.
locals {
  email_password_auth_flows = [
    "ALLOW_ADMIN_USER_PASSWORD_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
}

# ── Canonical consumer pool (v2) ──
#
# `area-code-prod-consumer-v2` (us-east-1_QnPocNSib) was created by hand on
# 2026-06-25 and given the `area-code-prod-consumer` Hosted UI domain + Google
# IdP. The web app (Amplify) and the API Lambda both target it, so every consumer
# access token is issued by this pool. The original `module.cognito_consumer`
# pool (us-east-1_nnSoej4pn) lost its Hosted UI domain and can no longer serve
# login; it is left in place (below) only to keep its 20 legacy users alive and
# no longer feeds the API.
#
# These resources are imported to match the live v2 pool exactly (it is serving
# all consumer auth — never let TF recreate it). The client name intentionally
# stays `area-code-prod-consumer-client` (not `-v2-client`); renaming it forces
# replacement and would break the app client id the web app uses. The OAuth /
# Hosted-UI client attributes (callback urls, scopes, IdPs) and the IdP
# provider_details are managed live and ignored here.
resource "aws_cognito_user_pool" "consumer_v2" {
  name = "area-code-prod-consumer-v2"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"

  password_policy {
    minimum_length    = 8
    require_lowercase = false
    require_numbers   = false
    require_symbols   = false
    require_uppercase = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # custom:citySlug / custom:userId are live; recreating schema forces a pool
  # replacement, so never diff it.
  lifecycle {
    ignore_changes = [schema]
  }
}

resource "aws_cognito_user_pool_client" "consumer_v2" {
  name         = "area-code-prod-consumer-client"
  user_pool_id = aws_cognito_user_pool.consumer_v2.id

  explicit_auth_flows = local.email_password_auth_flows

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"

  # Hosted-UI / OAuth attributes are Optional+Computed and managed live.
  lifecycle {
    ignore_changes = [
      callback_urls,
      logout_urls,
      allowed_oauth_flows,
      allowed_oauth_scopes,
      allowed_oauth_flows_user_pool_client,
      supported_identity_providers,
    ]
  }
}

resource "aws_cognito_user_pool_domain" "consumer_v2" {
  domain       = "area-code-prod-consumer"
  user_pool_id = aws_cognito_user_pool.consumer_v2.id
}

resource "aws_cognito_identity_provider" "consumer_v2_google" {
  user_pool_id  = aws_cognito_user_pool.consumer_v2.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = local.google_oauth.client_id
    client_secret    = local.google_oauth.client_secret
    authorize_scopes = "openid email profile"
  }

  attribute_mapping = {
    email       = "email"
    family_name = "family_name"
    given_name  = "given_name"
    name        = "name"
    username    = "sub"
  }

  # Cognito auto-populates the Google endpoint URLs; never diff provider_details.
  lifecycle {
    ignore_changes = [provider_details]
  }
}

# Consumer pool/client the API Lambda verifies against, now sourced from the
# imported v2 resources above.
locals {
  consumer_pool_id   = aws_cognito_user_pool.consumer_v2.id
  consumer_client_id = aws_cognito_user_pool_client.consumer_v2.id
}

module "cognito_consumer" {
  source                    = "../../modules/cognito"
  env                       = local.env
  pool_name                 = "consumer"
  explicit_auth_flows       = local.email_password_auth_flows
  define_auth_challenge_arn = module.cognito_triggers_consumer.define_auth_arn
  create_auth_challenge_arn = module.cognito_triggers_consumer.create_auth_arn
  verify_auth_challenge_arn = module.cognito_triggers_consumer.verify_auth_arn
}

module "cognito_business" {
  source                    = "../../modules/cognito"
  env                       = local.env
  pool_name                 = "business"
  explicit_auth_flows       = local.email_password_auth_flows
  define_auth_challenge_arn = module.cognito_triggers_business.define_auth_arn
  create_auth_challenge_arn = module.cognito_triggers_business.create_auth_arn
  verify_auth_challenge_arn = module.cognito_triggers_business.verify_auth_arn
}

module "cognito_staff" {
  source                    = "../../modules/cognito"
  env                       = local.env
  pool_name                 = "staff"
  access_token_ttl_hours    = 8
  explicit_auth_flows       = local.email_password_auth_flows
  define_auth_challenge_arn = module.cognito_triggers_staff.define_auth_arn
  create_auth_challenge_arn = module.cognito_triggers_staff.create_auth_arn
  verify_auth_challenge_arn = module.cognito_triggers_staff.verify_auth_arn

  # Hosted-UI Google sign-in (already live; codified here so terraform stops
  # planning to destroy the existing domain + Google IdP).
  enable_hosted_ui     = true
  google_client_id     = local.google_oauth.client_id
  google_client_secret = local.google_oauth.client_secret
}

module "cognito_admin" {
  source              = "../../modules/cognito"
  env                 = local.env
  pool_name           = "admin"
  username_attributes = ["email"]
  # Admin console requires TOTP MFA. SMS MFA is never configured (no-SMS rule);
  # only software-token (authenticator app) MFA is enabled by the module.
  mfa_configuration = "ON"
  explicit_auth_flows = [
    "ALLOW_ADMIN_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
  custom_attributes = [{
    name = "admin_role"
    type = "String"
  }]

  # Hosted-UI Google sign-in (already live; codified here so terraform stops
  # planning to destroy the existing domain + Google IdP).
  enable_hosted_ui     = true
  google_client_id     = local.google_oauth.client_id
  google_client_secret = local.google_oauth.client_secret
}

# --- Cognito CUSTOM_AUTH Lambda triggers ---
module "cognito_triggers_consumer" {
  source       = "../../modules/cognito-triggers"
  env          = local.env
  pool_name    = "consumer"
  user_pool_id = module.cognito_consumer.user_pool_id
}

module "cognito_triggers_business" {
  source       = "../../modules/cognito-triggers"
  env          = local.env
  pool_name    = "business"
  user_pool_id = module.cognito_business.user_pool_id
}

module "cognito_triggers_staff" {
  source       = "../../modules/cognito-triggers"
  env          = local.env
  pool_name    = "staff"
  user_pool_id = module.cognito_staff.user_pool_id
}

# --- S3 media bucket ---
module "s3_media" {
  source = "../../modules/s3"
  env    = local.env
  allowed_origins = [
    "https://areacode.co.za",
    "https://business.areacode.co.za",
    "https://staff.areacode.co.za",
    "https://admin.areacode.co.za"
  ]
}

# --- Media CDN (CloudFront in front of the private media bucket) ---
module "media_cdn" {
  source                      = "../../modules/cdn"
  env                         = local.env
  bucket_id                   = module.s3_media.bucket_id
  bucket_arn                  = module.s3_media.bucket_arn
  bucket_regional_domain_name = module.s3_media.bucket_regional_domain_name

  # Serve venue photos from cdn.areacode.co.za (matches VITE_CDN_URL) instead of
  # the raw *.cloudfront.net domain. Cert + DNS records defined in the custom
  # domain section below.
  custom_domain       = local.media_domain_enabled ? local.media_cdn_domain : ""
  acm_certificate_arn = local.media_domain_enabled ? aws_acm_certificate_validation.media_cdn[0].certificate_arn : ""
}

# =============================================================================
# SERVERLESS DATABASE - DynamoDB (replaces RDS PostgreSQL)
# Pay per request, scales to zero - ~$0-10/month vs ~$70/month for RDS
# =============================================================================

resource "aws_dynamodb_table" "users" {
  name         = "area-code-${local.env}-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "email"
    type = "S"
  }

  attribute {
    name = "cognitoSub"
    type = "S"
  }

  # People search (add-a-friend). Sparse, char-bucketed prefix indexes: the app
  # writes usernameLower/displayNameLower plus a single-char bucket key derived
  # from the first character. Search runs `<field>Char = q[0] AND
  # begins_with(<field>Lower, q)`, replacing the full-table Scan. The char
  # bucket spreads writes/reads across ~36 partitions instead of one hot key.
  # Sparse: identity lock rows (EMAIL#/SUB#) carry none of these attributes and
  # never appear here.
  attribute {
    name = "usernameChar"
    type = "S"
  }

  attribute {
    name = "usernameLower"
    type = "S"
  }

  attribute {
    name = "displayNameChar"
    type = "S"
  }

  attribute {
    name = "displayNameLower"
    type = "S"
  }

  global_secondary_index {
    name            = "EmailIndex"
    hash_key        = "email"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "CognitoIndex"
    hash_key        = "cognitoSub"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "UsernameSearchIndex"
    hash_key        = "usernameChar"
    range_key       = "usernameLower"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "DisplayNameSearchIndex"
    hash_key        = "displayNameChar"
    range_key       = "displayNameLower"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  tags = { Environment = local.env }
}

resource "aws_dynamodb_table" "nodes" {
  name         = "area-code-${local.env}-nodes"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "nodeId"

  attribute {
    name = "nodeId"
    type = "S"
  }

  attribute {
    name = "businessId"
    type = "S"
  }

  attribute {
    name = "location"
    type = "S"
  }

  attribute {
    name = "cityId"
    type = "S"
  }

  global_secondary_index {
    name            = "BusinessIndex"
    hash_key        = "businessId"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "LocationIndex"
    hash_key        = "location"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "CityIndex"
    hash_key        = "cityId"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  tags = { Environment = local.env }
}

resource "aws_dynamodb_table" "checkins" {
  name         = "area-code-${local.env}-checkins"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "checkInId"
  range_key    = "timestamp"

  attribute {
    name = "checkInId"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "N"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "nodeId"
    type = "S"
  }

  global_secondary_index {
    name            = "UserIndex"
    hash_key        = "userId"
    range_key       = "timestamp"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "NodeIndex"
    hash_key        = "nodeId"
    range_key       = "timestamp"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery { enabled = true }

  tags = { Environment = local.env }
}

resource "aws_dynamodb_table" "rewards" {
  name         = "area-code-${local.env}-rewards"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "rewardId"

  attribute {
    name = "rewardId"
    type = "S"
  }

  attribute {
    name = "businessId"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  global_secondary_index {
    name            = "BusinessIndex"
    hash_key        = "businessId"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "StatusIndex"
    hash_key        = "status"
    projection_type = "ALL"
  }

  attribute {
    name = "nodeId"
    type = "S"
  }

  global_secondary_index {
    name            = "NodeIndex"
    hash_key        = "nodeId"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  tags = { Environment = local.env }
}

resource "aws_dynamodb_table" "businesses" {
  name         = "area-code-${local.env}-businesses"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "businessId"

  attribute {
    name = "businessId"
    type = "S"
  }

  attribute {
    name = "ownerId"
    type = "S"
  }

  global_secondary_index {
    name            = "OwnerIndex"
    hash_key        = "ownerId"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  tags = { Environment = local.env }
}

resource "aws_dynamodb_table" "presence" {
  name         = "area-code-${local.env}-presence"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "nodeId"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "nodeId"
    type = "S"
  }

  attribute {
    name = "expiresAt"
    type = "N"
  }

  # NodeIndex: the honest Live_Presence_Count read (`expiresAt > now`) and the
  # serverless expiry sweep (`expiresAt <= now`) both query present records by
  # nodeId with an expiresAt range. projection ALL so the read model needs no
  # follow-up GetItem. (presence-integrity spec, task 1.1)
  global_secondary_index {
    name            = "NodeIndex"
    hash_key        = "nodeId"
    range_key       = "expiresAt"
    projection_type = "ALL"
  }

  # A Presence_Record is physically removed a bounded grace period after it
  # expires. TTL is cleanup only and is NOT the authoritative count — the read
  # model excludes `expiresAt <= now` records regardless of TTL lag.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery { enabled = true }

  tags = { Environment = local.env }
}

resource "aws_dynamodb_table" "app_data" {
  name         = "area-code-${local.env}-app-data"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "gsi1pk"
    type = "S"
  }

  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery { enabled = true }

  tags = { Environment = local.env }
}

# Booster pricing floor seed (booster-pricing-floor-and-audit R3.5, R9.4)
#   PK = BOOST_FLOOR
#   SK = <duration>  (one of 2hr | 6hr | 24hr)
# Seeded equal to the BOOST_PRICING const so the rejection branch never fires
# on day one. Admins update these rows via PUT /v1/admin/boost-floors/:duration;
# `lifecycle.ignore_changes = [item]` prevents Terraform from overwriting their
# changes on subsequent applies. PAY_PER_REQUEST table — no extra cost.
locals {
  boost_floor_seed_cents = {
    "2hr"  = 2500
    "6hr"  = 5000
    "24hr" = 15000
  }
}

resource "aws_dynamodb_table_item" "boost_floor_seed" {
  for_each   = local.boost_floor_seed_cents
  table_name = aws_dynamodb_table.app_data.name
  hash_key   = aws_dynamodb_table.app_data.hash_key
  range_key  = aws_dynamodb_table.app_data.range_key

  item = jsonencode({
    pk         = { S = "BOOST_FLOOR" }
    sk         = { S = each.key }
    duration   = { S = each.key }
    floorCents = { N = tostring(each.value) }
    currency   = { S = "ZAR" }
    updatedAt  = { S = timestamp() }
    updatedBy  = { S = "system:terraform-seed" }
  })

  lifecycle {
    ignore_changes = [item]
  }
}

# Live_Vibe_on_Map: per-business Music_Schedule rows.
#   PK = BUSINESS#<businessId>
#   SK = SCHEDULE#<scheduleId>
# GSI ByNextTransition is sparse — only schedules with at least one slot
# carry `gsi1pk` / `nextTransitionAt`, so the schedule-transition-tick
# Lambda can BETWEEN-query upcoming boundaries without scanning empty rows.
resource "aws_dynamodb_table" "music_schedules" {
  name         = "area-code-${local.env}-music-schedules"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "gsi1pk"
    type = "S"
  }

  attribute {
    name = "nextTransitionAt"
    type = "S"
  }

  global_secondary_index {
    name            = "ByNextTransition"
    hash_key        = "gsi1pk"
    range_key       = "nextTransitionAt"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  tags = { Environment = local.env }
}

# --- Lambda functions ---

# Monolith API Lambda — serves all Fastify routes via API Gateway catch-all
module "lambda_api" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "api"
  handler       = "index.handler"
  timeout       = 30
  memory_size   = 512
  tracing_mode  = "Active"
  environment_variables = {
    AREA_CODE_ENV         = local.env
    USERS_TABLE           = aws_dynamodb_table.users.name
    NODES_TABLE           = aws_dynamodb_table.nodes.name
    CHECKINS_TABLE        = aws_dynamodb_table.checkins.name
    REWARDS_TABLE         = aws_dynamodb_table.rewards.name
    BUSINESSES_TABLE      = aws_dynamodb_table.businesses.name
    APP_DATA_TABLE        = aws_dynamodb_table.app_data.name
    MUSIC_SCHEDULES_TABLE = aws_dynamodb_table.music_schedules.name
    # Presence is provisioned by the presence-integrity spec. Env name follows the
    # per-env convention so the API references the prod table, never a dev one.
    PRESENCE_TABLE             = "area-code-${local.env}-presence"
    AREA_CODE_REWARD_QUEUE_URL = module.sqs_reward_eval.queue_url
    # Pinned to the v2 pool that owns the live Hosted UI domain (see locals above).
    AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID = local.consumer_pool_id
    AREA_CODE_COGNITO_CONSUMER_CLIENT_ID    = local.consumer_client_id
    AREA_CODE_COGNITO_BUSINESS_USER_POOL_ID = module.cognito_business.user_pool_id
    AREA_CODE_COGNITO_BUSINESS_CLIENT_ID    = module.cognito_business.client_id
    AREA_CODE_COGNITO_STAFF_USER_POOL_ID    = module.cognito_staff.user_pool_id
    AREA_CODE_COGNITO_STAFF_CLIENT_ID       = module.cognito_staff.client_id
    AREA_CODE_COGNITO_ADMIN_USER_POOL_ID    = module.cognito_admin.user_pool_id
    AREA_CODE_COGNITO_ADMIN_CLIENT_ID       = module.cognito_admin.client_id
    AREA_CODE_S3_MEDIA_BUCKET               = module.s3_media.bucket_name
    AREA_CODE_CONSENT_VERSION               = "v1.0"
    AREA_CODE_ANONYMIZATION_SALT            = var.anonymization_salt
    # Win-back campaigns: the API async-invokes this dispatcher on send-now.
    AREA_CODE_CAMPAIGN_DISPATCHER_FUNCTION = module.lambda_campaign_dispatcher.function_name
    # HMAC secret used for QR codes AND Spotify OAuth state signing
    AREA_CODE_QR_HMAC_SECRET = data.aws_secretsmanager_secret_version.qr_hmac.secret_string
    # Spotify OAuth — supplied via TF variables (terraform.tfvars or TF_VAR_*)
    SPOTIFY_CLIENT_ID     = var.spotify_client_id
    SPOTIFY_CLIENT_SECRET = var.spotify_client_secret
    SPOTIFY_REDIRECT_URI  = var.spotify_redirect_uri
    # Yoco payment gateway — supplied via TF variables (terraform.tfvars or TF_VAR_*)
    YOCO_PROD_SECRET_KEY = var.yoco_secret_key
    YOCO_WEBHOOK_SECRET  = var.yoco_webhook_secret
    # Business portal URL for Yoco checkout redirects
    BUSINESS_APP_URL = "https://business.areacode.co.za"
    # WebSocket broadcast support — allows API Lambda to push events to connected clients
    CONNECTIONS_TABLE  = module.websocket.connections_table_name
    WEBSOCKET_ENDPOINT = replace(module.websocket.websocket_api_endpoint, "wss://", "https://")
    # Web push (VAPID) — no-op if keys are empty
    AREA_CODE_VAPID_PUBLIC_KEY  = var.vapid_public_key
    AREA_CODE_VAPID_PRIVATE_KEY = var.vapid_private_key
    AREA_CODE_VAPID_SUBJECT     = "mailto:tech@areacode.co.za"
    # Apple Music integration — no-op if keys are empty
    APPLE_MUSIC_TEAM_ID     = var.apple_music_team_id
    APPLE_MUSIC_KEY_ID      = var.apple_music_key_id
    APPLE_MUSIC_PRIVATE_KEY = var.apple_music_private_key
    # Release identity is baked into the bundle at build:lambda time and served
    # by GET /health as `commit`; there is no separate GIT_SHA env var (one
    # source of truth, and the baked sha tracks the artifact, not terraform).
  }
}

# Legacy per-route Lambdas (check-in, node-detail, rewards-near-me) were removed
# from production in May 2026. All routes are now served by the monolith API Lambda
# via the `$default` API Gateway integration. The retired Terraform blocks were
# removed; see git history if historical reference is needed.

# Not in VPC: the VPC has no NAT (banned, serverless-only.md) and no DynamoDB
# gateway endpoint, so an in-VPC Lambda has no route to DynamoDB or the public
# web-push/Expo endpoints - every invocation hung to timeout (found 2026-07-05
# redriving the reward-eval DLQ). All working Lambdas (api, presence-expiry,
# campaign-sender, streak-reminder) run outside the VPC; workers match that.
module "lambda_reward_evaluator" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "reward-evaluator"
  timeout       = 30
  memory_size   = 256
  environment_variables = {
    AREA_CODE_ENV = local.env
    # Full table closure: rewards + redemption/city rows in app-data, node
    # lookup (getNodeById), and per-user check-in counts. Table-name env vars
    # must always be set in prod (no-fallbacks-no-legacy); missing
    # REWARDS_TABLE was the 2026-07-03 go-live FAIL and the reward-eval DLQ
    # backlog root cause.
    REWARDS_TABLE  = aws_dynamodb_table.rewards.name
    APP_DATA_TABLE = aws_dynamodb_table.app_data.name
    NODES_TABLE    = aws_dynamodb_table.nodes.name
    CHECKINS_TABLE = aws_dynamodb_table.checkins.name
    # CONNECTIONS_TABLE is read at module load by the broadcast helper (imported
    # transitively via shared/socket/events for the reward-claimed emitters), so
    # it must be set or the Lambda crashes at cold start in prod. Delivery still
    # falls back to push (no execute-api IAM / endpoint here, by design).
    CONNECTIONS_TABLE = module.websocket.connections_table_name
    # Web push (VAPID) - reward-earned delivery always falls back to push from
    # Lambda (no in-process socket).
    AREA_CODE_VAPID_PUBLIC_KEY  = var.vapid_public_key
    AREA_CODE_VAPID_PRIVATE_KEY = var.vapid_private_key
    AREA_CODE_VAPID_SUBJECT     = "mailto:tech@areacode.co.za"
  }
}

# Not in VPC: see lambda_reward_evaluator note (dead-end VPC, no DDB route).
module "lambda_pulse_decay" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "pulse-decay"
  timeout       = 120
  memory_size   = 256
  environment_variables = {
    AREA_CODE_ENV = local.env
    USERS_TABLE   = aws_dynamodb_table.users.name
    # Decay state lives in app-data; the sweep walks nodes. Missing
    # APP_DATA_TABLE was a 2026-07-03 go-live FAIL (worker crashed at startup).
    APP_DATA_TABLE = aws_dynamodb_table.app_data.name
    NODES_TABLE    = aws_dynamodb_table.nodes.name
    # emitStateChange pulls in the broadcast helper, which reads CONNECTIONS_TABLE
    # at module load, so it must be set or the worker crashes at cold start in
    # prod (the room broadcast itself no-ops without an endpoint, by design).
    CONNECTIONS_TABLE = module.websocket.connections_table_name
  }
}

# Presence expiry sweep — arm64 Lambda on EventBridge rate(5 minutes), the
# serverless half of honest presence (presence-integrity spec, task 12). Expires
# due `present` records, captures bounded dwell, reconciles the cached counter to
# the authoritative record-derived count, and best-effort broadcasts the honest
# count. In VPC to match the other DynamoDB workers; the websocket broadcast is
# best-effort and wrapped, mirroring schedule-transition-tick.
module "lambda_presence_expiry" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "presence-expiry"
  timeout       = 120
  memory_size   = 256
  # Not in VPC: this worker only calls public AWS endpoints (DynamoDB and the
  # WebSocket management API). serverless-only forbids NAT and interface
  # endpoints, so running it outside the VPC is the correct path to reach them.
  environment_variables = {
    AREA_CODE_ENV  = local.env
    USERS_TABLE    = aws_dynamodb_table.users.name
    NODES_TABLE    = aws_dynamodb_table.nodes.name
    APP_DATA_TABLE = aws_dynamodb_table.app_data.name
    PRESENCE_TABLE = aws_dynamodb_table.presence.name
    # WebSocket broadcast of the honest count (best-effort). CONNECTIONS_TABLE is
    # read at module load by the broadcast helper, so it must be set.
    CONNECTIONS_TABLE  = module.websocket.connections_table_name
    WEBSOCKET_ENDPOINT = replace(module.websocket.websocket_api_endpoint, "wss://", "https://")
  }
}

# The API Lambda emits realtime events (node:created, node:pulse_update,
# check-in fan-out) via broadcastToRoom, which Queries the connections-table
# GSIs and calls PostToConnection. Without this policy every broadcast dies
# with AccessDeniedException (observed 2026-07-09/10 go-live FAIL).
resource "aws_iam_role_policy" "api_websocket" {
  name = "websocket-manage"
  role = module.lambda_api.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["execute-api:ManageConnections", "execute-api:Invoke"]
        Resource = "arn:aws:execute-api:us-east-1:*:${module.websocket.websocket_api_id}/*"
      },
      {
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:DeleteItem"]
        Resource = [
          module.websocket.connections_table_arn,
          "${module.websocket.connections_table_arn}/index/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "presence_expiry_websocket" {
  name = "websocket-manage"
  role = module.lambda_presence_expiry.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["execute-api:ManageConnections", "execute-api:Invoke"]
        Resource = "arn:aws:execute-api:us-east-1:*:${module.websocket.websocket_api_id}/*"
      },
      {
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = [
          module.websocket.connections_table_arn,
          "${module.websocket.connections_table_arn}/index/*"
        ]
      }
    ]
  })
}

# Streak-at-risk reminder — arm64 Lambda on an EventBridge daily SAST-evening
# schedule (churn-defences). Scans streak-holders and pushes the "your streak is
# about to break" nudge to opted-in users who have not checked in today. Not in
# VPC: it only calls public AWS endpoints (DynamoDB) and web-push/Expo over
# HTTPS, matching presence-expiry.
module "lambda_streak_reminder" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "streak-reminder"
  timeout       = 120
  memory_size   = 256
  environment_variables = {
    AREA_CODE_ENV  = local.env
    USERS_TABLE    = aws_dynamodb_table.users.name
    CHECKINS_TABLE = aws_dynamodb_table.checkins.name
    APP_DATA_TABLE = aws_dynamodb_table.app_data.name
    # sendNotification (notifications/service) pulls in the broadcast helper,
    # which reads CONNECTIONS_TABLE at module load, so it must be set or the
    # worker crashes at cold start in prod. Delivery falls back to push.
    CONNECTIONS_TABLE = module.websocket.connections_table_name
    # Web push (VAPID) — reminder falls back to push for backgrounded users.
    AREA_CODE_VAPID_PUBLIC_KEY  = var.vapid_public_key
    AREA_CODE_VAPID_PRIVATE_KEY = var.vapid_private_key
    AREA_CODE_VAPID_SUBJECT     = "mailto:tech@areacode.co.za"
  }
}

# Not in VPC: see lambda_reward_evaluator note (dead-end VPC, no DDB route).
module "lambda_leaderboard_reset" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "leaderboard-reset"
  timeout       = 120
  memory_size   = 256
  environment_variables = {
    AREA_CODE_ENV = local.env
    # Leaderboard entries, history, and notification prefs all live in app-data.
    APP_DATA_TABLE = aws_dynamodb_table.app_data.name
  }
}

# Not in VPC: see lambda_reward_evaluator note (dead-end VPC, no DDB route).
module "lambda_partition_manager" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "partition-manager"
  timeout       = 60
  environment_variables = {
    AREA_CODE_ENV = local.env
  }
}

# Not in VPC: see lambda_reward_evaluator note (dead-end VPC, no DDB route).
module "lambda_cleanup" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "cleanup"
  timeout       = 120
  memory_size   = 256
  environment_variables = {
    AREA_CODE_ENV = local.env
    # POPIA erasure sweep touches users, check-ins, app-data, live socket
    # connections, and the consumer Cognito pool.
    USERS_TABLE       = aws_dynamodb_table.users.name
    CHECKINS_TABLE    = aws_dynamodb_table.checkins.name
    APP_DATA_TABLE    = aws_dynamodb_table.app_data.name
    CONNECTIONS_TABLE = module.websocket.connections_table_name
    # The daily cleanup also runs the billing lapse sweep (business/service
    # startLapseSweep + enforceLapsedPayments → businesses, nodes, rewards) and
    # the orphaned threshold-lock cleanup (rewards, via getRewardById). Without
    # these three the prod sweeps fail: the lapse sweeps throw and are swallowed
    # (silent no-op, businesses never demoted), and the lock cleanup's swallowed
    # requireEnv makes every reward read as deleted and wrongly drops every lock.
    BUSINESSES_TABLE                        = aws_dynamodb_table.businesses.name
    NODES_TABLE                             = aws_dynamodb_table.nodes.name
    REWARDS_TABLE                           = aws_dynamodb_table.rewards.name
    AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID = local.consumer_pool_id
    AREA_CODE_COGNITO_CONSUMER_CLIENT_ID    = local.consumer_client_id
  }
}

# The dedicated yoco-webhook Lambda was deleted 2026-07-10: it never had a
# code home in the repo, so prod ran the module placeholder (200 'placeholder'
# to every request), silently swallowing payment webhooks. The one path is the
# monolith's POST /v1/webhooks/yoco (processYocoWebhook, fail-closed HMAC),
# reached via the api_catchall $default route.

# Report dispatcher Lambda — triggered by EventBridge, fans out SQS messages per business
module "lambda_report_dispatcher" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "report-dispatcher"
  timeout       = 30
  memory_size   = 256
  environment_variables = {
    AREA_CODE_ENV              = local.env
    BUSINESSES_TABLE           = aws_dynamodb_table.businesses.name
    NODES_TABLE                = aws_dynamodb_table.nodes.name
    CHECKINS_TABLE             = aws_dynamodb_table.checkins.name
    AREA_CODE_REPORT_QUEUE_URL = module.sqs_report_generation.queue_url
  }
}

# Report generator Lambda — SQS-triggered worker, generates one report per business
module "lambda_report_generator" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "report-generator"
  timeout       = 120
  memory_size   = 512
  environment_variables = {
    AREA_CODE_ENV                = local.env
    USERS_TABLE                  = aws_dynamodb_table.users.name
    NODES_TABLE                  = aws_dynamodb_table.nodes.name
    CHECKINS_TABLE               = aws_dynamodb_table.checkins.name
    REWARDS_TABLE                = aws_dynamodb_table.rewards.name
    BUSINESSES_TABLE             = aws_dynamodb_table.businesses.name
    APP_DATA_TABLE               = aws_dynamodb_table.app_data.name
    AREA_CODE_REPORT_QUEUE_URL   = module.sqs_report_generation.queue_url
    AREA_CODE_ANONYMIZATION_SALT = var.anonymization_salt
  }
}

# Win-back campaign dispatcher Lambda — async-invoked by the API on send-now;
# resolves the segment, applies consent/opt-out + frequency-cap + quota filters,
# then fans batches of <=100 recipients out to the campaign-send queue.
module "lambda_campaign_dispatcher" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "campaign-dispatcher"
  timeout       = 60
  memory_size   = 512
  environment_variables = {
    AREA_CODE_ENV                     = local.env
    USERS_TABLE                       = aws_dynamodb_table.users.name
    NODES_TABLE                       = aws_dynamodb_table.nodes.name
    CHECKINS_TABLE                    = aws_dynamodb_table.checkins.name
    BUSINESSES_TABLE                  = aws_dynamodb_table.businesses.name
    APP_DATA_TABLE                    = aws_dynamodb_table.app_data.name
    AREA_CODE_CAMPAIGN_SEND_QUEUE_URL = module.sqs_campaign_send.queue_url
  }
}

# Win-back campaign sender Lambda — SQS-triggered worker; delivers one batch via
# email (SES), writing one anonymized send record per recipient. Shares the QR
# HMAC secret so the unsubscribe tokens it signs verify against the API's
# unsubscribe route.
module "lambda_campaign_sender" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "campaign-sender"
  timeout       = 120
  memory_size   = 512
  environment_variables = {
    AREA_CODE_ENV            = local.env
    USERS_TABLE              = aws_dynamodb_table.users.name
    BUSINESSES_TABLE         = aws_dynamodb_table.businesses.name
    APP_DATA_TABLE           = aws_dynamodb_table.app_data.name
    AREA_CODE_API_BASE_URL   = "https://api.areacode.co.za"
    AREA_CODE_QR_HMAC_SECRET = data.aws_secretsmanager_secret_version.qr_hmac.secret_string
  }
}

# Live_Vibe_on_Map: schedule-transition-tick worker.
#
# Invoked every minute by EventBridge. Queries the `MusicSchedules`
# `ByNextTransition` GSI for schedules whose `nextTransitionAt` is inside
# the next 60s window and fans out one Evaluation_Tick to the in-process
# `evaluateLiveArchetype` orchestrator (see backend/src/workers/
# schedule-transition-tick.ts). The evaluator is short-circuited to a no-op
# while `LIVE_VIBE_ON_MAP_FLAG` is "false" (R12.5) so this can ship before
# the canary flip without consuming DynamoDB budget.
# Not in VPC: see lambda_reward_evaluator note (dead-end VPC, no DDB route).
module "lambda_schedule_transition_tick" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "schedule-transition-tick"
  handler       = "index.handler"
  timeout       = 60
  memory_size   = 256
  environment_variables = {
    AREA_CODE_ENV         = local.env
    MUSIC_SCHEDULES_TABLE = aws_dynamodb_table.music_schedules.name
    NODES_TABLE           = aws_dynamodb_table.nodes.name
    CHECKINS_TABLE        = aws_dynamodb_table.checkins.name
    APP_DATA_TABLE        = aws_dynamodb_table.app_data.name
    LIVE_VIBE_ON_MAP_FLAG = "false"
    # The tick imports live-archetype-evaluator, which loads the broadcast helper
    # at module load; CONNECTIONS_TABLE must be set or the worker crashes at cold
    # start in prod. It emits node:archetype_change to the city room (it already
    # holds execute-api IAM below), so it also needs the WebSocket endpoint to
    # actually broadcast once LIVE_VIBE_ON_MAP_FLAG flips — mirrors presence-expiry.
    CONNECTIONS_TABLE  = module.websocket.connections_table_name
    WEBSOCKET_ENDPOINT = replace(module.websocket.websocket_api_endpoint, "wss://", "https://")
  }
}

resource "aws_iam_role_policy" "schedule_transition_tick_dynamodb" {
  name = "dynamodb-access"
  role = module.lambda_schedule_transition_tick.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query"
      ]
      Resource = [
        aws_dynamodb_table.music_schedules.arn,
        "${aws_dynamodb_table.music_schedules.arn}/index/*",
        aws_dynamodb_table.nodes.arn,
        "${aws_dynamodb_table.nodes.arn}/index/*",
        aws_dynamodb_table.checkins.arn,
        "${aws_dynamodb_table.checkins.arn}/index/*",
        aws_dynamodb_table.app_data.arn,
        "${aws_dynamodb_table.app_data.arn}/index/*"
      ]
    }]
  })
}

resource "aws_iam_role_policy" "schedule_transition_tick_websocket" {
  name = "websocket-manage"
  role = module.lambda_schedule_transition_tick.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["execute-api:ManageConnections", "execute-api:Invoke"]
        Resource = "arn:aws:execute-api:us-east-1:*:${module.websocket.websocket_api_id}/*"
      },
      {
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = [
          module.websocket.connections_table_arn,
          "${module.websocket.connections_table_arn}/index/*"
        ]
      }
    ]
  })
}

# --- Lambda DynamoDB IAM permissions ---
resource "aws_iam_role_policy" "lambda_dynamodb" {
  for_each = {
    api               = module.lambda_api.role_name
    pulse_decay       = module.lambda_pulse_decay.role_name
    reward_evaluator  = module.lambda_reward_evaluator.role_name
    leaderboard_reset = module.lambda_leaderboard_reset.role_name
    cleanup           = module.lambda_cleanup.role_name
    websocket         = module.lambda_websocket.role_name
    presence_expiry   = module.lambda_presence_expiry.role_name
    streak_reminder   = module.lambda_streak_reminder.role_name
  }

  name = "dynamodb-access"
  role = each.value

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        # Batch variants of the single-item grants above (same tables, no wider
        # blast radius). Missing BatchGetItem broke the business audience read
        # (api BatchGets users) and missing BatchWriteItem breaks the cleanup
        # retention sweeps (observed AccessDenied 2026-07-10/11).
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem"
      ]
      Resource = [
        aws_dynamodb_table.users.arn,
        aws_dynamodb_table.nodes.arn,
        aws_dynamodb_table.checkins.arn,
        aws_dynamodb_table.rewards.arn,
        aws_dynamodb_table.businesses.arn,
        aws_dynamodb_table.app_data.arn,
        aws_dynamodb_table.presence.arn,
        aws_dynamodb_table.music_schedules.arn,
        "${aws_dynamodb_table.users.arn}/index/*",
        "${aws_dynamodb_table.nodes.arn}/index/*",
        "${aws_dynamodb_table.checkins.arn}/index/*",
        "${aws_dynamodb_table.rewards.arn}/index/*",
        "${aws_dynamodb_table.businesses.arn}/index/*",
        "${aws_dynamodb_table.app_data.arn}/index/*",
        "${aws_dynamodb_table.presence.arn}/index/*",
        "${aws_dynamodb_table.music_schedules.arn}/index/*"
      ]
    }]
  })
}

# --- Lambda IAM: API Lambda -> Cognito (auth operations) ---
resource "aws_iam_role_policy" "api_cognito" {
  name = "cognito-access"
  role = module.lambda_api.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "cognito-idp:AdminGetUser",
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminSetUserPassword",
        "cognito-idp:AdminUpdateUserAttributes",
        "cognito-idp:AdminDeleteUser",
        "cognito-idp:AdminInitiateAuth",
        "cognito-idp:AdminRespondToAuthChallenge",
        "cognito-idp:AdminSetUserMFAPreference",
        "cognito-idp:AssociateSoftwareToken",
        "cognito-idp:VerifySoftwareToken",
        "cognito-idp:SetUserMFAPreference",
        "cognito-idp:ListUsers",
        "cognito-idp:SignUp",
        "cognito-idp:InitiateAuth",
        "cognito-idp:RespondToAuthChallenge",
        "cognito-idp:GlobalSignOut"
      ]
      Resource = [
        # v2 is the live consumer pool the API operates on (ListUsers,
        # AdminUpdateUserAttributes during oauth-sync). The original
        # module.cognito_consumer pool is kept for its legacy users.
        aws_cognito_user_pool.consumer_v2.arn,
        module.cognito_consumer.user_pool_arn,
        module.cognito_business.user_pool_arn,
        module.cognito_staff.user_pool_arn,
        module.cognito_admin.user_pool_arn
      ]
    }]
  })
}

# --- SQS Queues ---
module "sqs_reward_eval" {
  source                = "../../modules/sqs"
  env                   = local.env
  queue_name            = "reward-eval"
  visibility_timeout    = 60
  lambda_function_arn   = module.lambda_reward_evaluator.function_arn
  enable_lambda_mapping = true
}

module "sqs_report_generation" {
  source                = "../../modules/sqs"
  env                   = local.env
  queue_name            = "report-generation"
  visibility_timeout    = 150
  max_receive_count     = 2
  lambda_function_arn   = module.lambda_report_generator.function_arn
  enable_lambda_mapping = true
}

# Win-back campaign-send queue — dispatcher publishes batches, sender consumes.
module "sqs_campaign_send" {
  source                = "../../modules/sqs"
  env                   = local.env
  queue_name            = "campaign-send"
  visibility_timeout    = 150
  max_receive_count     = 2
  lambda_function_arn   = module.lambda_campaign_sender.function_arn
  enable_lambda_mapping = true
}

# --- Lambda IAM: API + check-in -> SQS send ---
resource "aws_iam_role_policy" "api_sqs_send" {
  name = "sqs-send"
  role = module.lambda_api.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = [module.sqs_reward_eval.queue_arn]
    }]
  })
}

# --- Lambda IAM: API -> S3 media bucket (node header images) ---
# The API Lambda mints presigned PUT URLs for venue header-image uploads and
# post-processes/deletes those objects. A presigned URL only carries the
# permissions of the signing principal, so without this the browser PUT is
# denied with 403 (AccessDenied) even though the signature is valid.
resource "aws_iam_role_policy" "api_s3_media" {
  name = "s3-media-access"
  role = module.lambda_api.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ]
      Resource = "${module.s3_media.bucket_arn}/*"
    }]
  })
}

# --- Lambda IAM: API -> SES (transactional email) ---
# Powers email verification, password-reset codes, trial-expiry notices and
# win-back campaigns (backend/src/shared/email/ses.ts). Without this the SESv2
# SendEmail calls are denied with AccessDenied. Scoped to the verified sending
# identity for areacode.co.za in this account/region.
resource "aws_iam_role_policy" "api_ses_send" {
  name = "ses-send"
  role = module.lambda_api.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ]
      Resource = "*"
    }]
  })
}

# --- Lambda IAM: campaign-dispatcher -> DynamoDB + SQS send ---
resource "aws_iam_role_policy" "campaign_dispatcher_dynamodb" {
  name = "dynamodb-access"
  role = module.lambda_campaign_dispatcher.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        # campaigns/repository.ts BatchGets recipient user rows during segment
        # resolution (campaign_sender already grants this on the same path).
        "dynamodb:BatchGetItem"
      ]
      Resource = [
        aws_dynamodb_table.users.arn,
        "${aws_dynamodb_table.users.arn}/index/*",
        aws_dynamodb_table.nodes.arn,
        "${aws_dynamodb_table.nodes.arn}/index/*",
        aws_dynamodb_table.checkins.arn,
        "${aws_dynamodb_table.checkins.arn}/index/*",
        aws_dynamodb_table.businesses.arn,
        "${aws_dynamodb_table.businesses.arn}/index/*",
        aws_dynamodb_table.app_data.arn,
        "${aws_dynamodb_table.app_data.arn}/index/*"
      ]
    }]
  })
}

resource "aws_iam_role_policy" "campaign_dispatcher_sqs_send" {
  name = "sqs-send"
  role = module.lambda_campaign_dispatcher.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = [module.sqs_campaign_send.queue_arn]
    }]
  })
}

# --- Lambda IAM: campaign-sender -> DynamoDB + SQS + SES ---
resource "aws_iam_role_policy" "campaign_sender_dynamodb" {
  name = "dynamodb-access"
  role = module.lambda_campaign_sender.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query",
        "dynamodb:BatchGetItem"
      ]
      Resource = [
        aws_dynamodb_table.users.arn,
        "${aws_dynamodb_table.users.arn}/index/*",
        aws_dynamodb_table.businesses.arn,
        "${aws_dynamodb_table.businesses.arn}/index/*",
        aws_dynamodb_table.app_data.arn,
        "${aws_dynamodb_table.app_data.arn}/index/*"
      ]
    }]
  })
}

resource "aws_iam_role_policy" "campaign_sender_sqs" {
  name = "sqs-access"
  role = module.lambda_campaign_sender.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = [module.sqs_campaign_send.queue_arn]
      }
    ]
  })
}

resource "aws_iam_role_policy" "campaign_sender_ses" {
  name = "ses-send"
  role = module.lambda_campaign_sender.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = "*"
    }]
  })
}

# --- Lambda IAM: API -> campaign-dispatcher async invoke (win-back send-now) ---
resource "aws_iam_role_policy" "api_invoke_campaign_dispatcher" {
  name = "invoke-campaign-dispatcher"
  role = module.lambda_api.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = [module.lambda_campaign_dispatcher.function_arn]
    }]
  })
}

# --- Lambda IAM: reward-evaluator -> SQS ---
resource "aws_iam_role_policy" "reward_eval_sqs" {
  name = "sqs-access"
  role = module.lambda_reward_evaluator.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = module.sqs_reward_eval.queue_arn
      }
    ]
  })
}

# --- Lambda IAM: report-dispatcher -> DynamoDB read (businesses, nodes, checkins) ---
resource "aws_iam_role_policy" "report_dispatcher_dynamodb" {
  name = "dynamodb-read-access"
  role = module.lambda_report_dispatcher.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ]
      Resource = [
        aws_dynamodb_table.businesses.arn,
        "${aws_dynamodb_table.businesses.arn}/index/*",
        aws_dynamodb_table.nodes.arn,
        "${aws_dynamodb_table.nodes.arn}/index/*",
        aws_dynamodb_table.checkins.arn,
        "${aws_dynamodb_table.checkins.arn}/index/*"
      ]
    }]
  })
}

resource "aws_iam_role_policy" "report_dispatcher_sqs_send" {
  name = "sqs-send"
  role = module.lambda_report_dispatcher.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = [module.sqs_report_generation.queue_arn]
    }]
  })
}

# --- Lambda IAM: report-generator -> DynamoDB read/write (all tables) ---
resource "aws_iam_role_policy" "report_generator_dynamodb" {
  name = "dynamodb-access"
  role = module.lambda_report_generator.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        # generator.ts BatchGets user rows for crowd composition.
        "dynamodb:BatchGetItem"
      ]
      Resource = [
        aws_dynamodb_table.users.arn,
        "${aws_dynamodb_table.users.arn}/index/*",
        aws_dynamodb_table.nodes.arn,
        "${aws_dynamodb_table.nodes.arn}/index/*",
        aws_dynamodb_table.checkins.arn,
        "${aws_dynamodb_table.checkins.arn}/index/*",
        aws_dynamodb_table.rewards.arn,
        "${aws_dynamodb_table.rewards.arn}/index/*",
        aws_dynamodb_table.businesses.arn,
        "${aws_dynamodb_table.businesses.arn}/index/*",
        aws_dynamodb_table.app_data.arn,
        "${aws_dynamodb_table.app_data.arn}/index/*"
      ]
    }]
  })
}

resource "aws_iam_role_policy" "report_generator_sqs" {
  name = "sqs-access"
  role = module.lambda_report_generator.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = [module.sqs_report_generation.queue_arn]
      }
    ]
  })
}

resource "aws_iam_role_policy" "report_generator_websocket" {
  name = "websocket-manage"
  role = module.lambda_report_generator.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "execute-api:ManageConnections",
          "execute-api:Invoke"
        ]
        Resource = "arn:aws:execute-api:us-east-1:*:${module.websocket.websocket_api_id}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:Query"
        ]
        Resource = [
          module.websocket.connections_table_arn,
          "${module.websocket.connections_table_arn}/index/*"
        ]
      }
    ]
  })
}

# --- EventBridge Schedules ---
module "eventbridge_schedules" {
  source = "../../modules/eventbridge"
  env    = local.env

  schedules = {
    pulse-decay = {
      description          = "Pulse decay every 5 minutes"
      schedule_expression  = "rate(5 minutes)"
      lambda_arn           = module.lambda_pulse_decay.function_arn
      lambda_function_name = module.lambda_pulse_decay.function_name
    }
    presence-expiry = {
      description          = "Presence expiry sweep every 5 minutes (honest presence)"
      schedule_expression  = "rate(5 minutes)"
      lambda_arn           = module.lambda_presence_expiry.function_arn
      lambda_function_name = module.lambda_presence_expiry.function_name
    }
    streak-reminder = {
      description          = "Streak-at-risk reminder daily 18:00 SAST (16:00 UTC)"
      schedule_expression  = "cron(0 16 * * ? *)"
      lambda_arn           = module.lambda_streak_reminder.function_arn
      lambda_function_name = module.lambda_streak_reminder.function_name
    }
    leaderboard-reset = {
      description          = "Weekly leaderboard reset Monday 00:00 SAST"
      schedule_expression  = "cron(0 22 ? * SUN *)"
      lambda_arn           = module.lambda_leaderboard_reset.function_arn
      lambda_function_name = module.lambda_leaderboard_reset.function_name
    }
    partition-manager = {
      description          = "Check-in table partition management daily"
      schedule_expression  = "cron(0 1 * * ? *)"
      lambda_arn           = module.lambda_partition_manager.function_arn
      lambda_function_name = module.lambda_partition_manager.function_name
    }
    cleanup = {
      description          = "Cleanup expired tokens/data daily"
      schedule_expression  = "cron(0 2 * * ? *)"
      lambda_arn           = module.lambda_cleanup.function_arn
      lambda_function_name = module.lambda_cleanup.function_name
    }
    report-weekly = {
      description          = "Weekly intelligence report generation Monday 06:00 SAST (04:00 UTC)"
      schedule_expression  = "cron(0 4 ? * MON *)"
      lambda_arn           = module.lambda_report_dispatcher.function_arn
      lambda_function_name = module.lambda_report_dispatcher.function_name
    }
    report-monthly = {
      description          = "Monthly intelligence report 1st of month 06:00 SAST (04:00 UTC)"
      schedule_expression  = "cron(0 4 1 * ? *)"
      lambda_arn           = module.lambda_report_dispatcher.function_arn
      lambda_function_name = module.lambda_report_dispatcher.function_name
    }
    schedule-transition-tick = {
      # Live_Vibe_on_Map evaluation tick (R11.5). EventBridge's minimum
      # cadence is `rate(1 minute)`, matching the design's 60s window.
      description          = "Live Vibe on Map schedule transition tick (every minute)"
      schedule_expression  = "rate(1 minute)"
      lambda_arn           = module.lambda_schedule_transition_tick.function_arn
      lambda_function_name = module.lambda_schedule_transition_tick.function_name
    }
  }
}

# --- API Gateway ---
module "api_gateway" {
  source = "../../modules/api-gateway"
  env    = local.env

  additional_cors_origins = [
    "https://master.d3pm78r41ma6w6.amplifyapp.com",
    "https://master.dbp54yxhyjvk0.amplifyapp.com",
    "https://master.d166bb81tg4k61.amplifyapp.com",
    "https://master.d1ay6jict0ql9w.amplifyapp.com",
  ]

  lambda_integrations = {
    # Monolith catch-all — serves all Fastify routes, including the
    # /v1/business/{businessId}/music-schedule[/...] schedule-CRUD routes
    # added in the live-vibe-on-map spec (task 7.3). New backend routes
    # that live inside `lambda_api` do NOT require additional IaC entries
    # here — they are picked up by Fastify's router at runtime.
    api_catchall = {
      invoke_arn = module.lambda_api.invoke_arn
      route_key  = "$default"
    }
  }
}

# --- Lambda -> API Gateway permissions ---
resource "aws_lambda_permission" "apigw_api" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.api_execution_arn}/*/*"
}

# =============================================================================
# Custom domain (api.areacode.co.za) — optional, gated on enable_api_custom_domain
# =============================================================================

data "aws_route53_zone" "root" {
  count        = var.enable_api_custom_domain ? 1 : 0
  name         = "areacode.co.za"
  private_zone = false
}

resource "aws_acm_certificate" "api" {
  count             = var.enable_api_custom_domain ? 1 : 0
  domain_name       = "api.areacode.co.za"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = var.enable_api_custom_domain ? {
    for dvo in aws_acm_certificate.api[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.root[0].zone_id
}

resource "aws_acm_certificate_validation" "api" {
  count                   = var.enable_api_custom_domain ? 1 : 0
  certificate_arn         = aws_acm_certificate.api[0].arn
  validation_record_fqdns = [for r in aws_route53_record.api_cert_validation : r.fqdn]
}

resource "aws_apigatewayv2_domain_name" "api" {
  count       = var.enable_api_custom_domain ? 1 : 0
  domain_name = "api.areacode.co.za"

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.api[0].certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "api" {
  count       = var.enable_api_custom_domain ? 1 : 0
  api_id      = module.api_gateway.api_id
  domain_name = aws_apigatewayv2_domain_name.api[0].id
  stage       = "$default"
}

resource "aws_route53_record" "api" {
  count   = var.enable_api_custom_domain ? 1 : 0
  zone_id = data.aws_route53_zone.root[0].zone_id
  name    = "api.areacode.co.za"
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.api[0].domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.api[0].domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

# =============================================================================
# Custom domain (cdn.areacode.co.za) for the media CDN — gated on
# enable_media_custom_domain (which also requires enable_api_custom_domain, as
# both share the areacode.co.za zone above). CloudFront requires its ACM
# certificate in us-east-1; this stack's provider is already us-east-1.
# =============================================================================

resource "aws_acm_certificate" "media_cdn" {
  count             = local.media_domain_enabled ? 1 : 0
  domain_name       = local.media_cdn_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "media_cdn_cert_validation" {
  for_each = local.media_domain_enabled ? {
    for dvo in aws_acm_certificate.media_cdn[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.root[0].zone_id
}

resource "aws_acm_certificate_validation" "media_cdn" {
  count                   = local.media_domain_enabled ? 1 : 0
  certificate_arn         = aws_acm_certificate.media_cdn[0].arn
  validation_record_fqdns = [for r in aws_route53_record.media_cdn_cert_validation : r.fqdn]
}

# Alias cdn.areacode.co.za at the CloudFront distribution. Both A and AAAA so
# IPv6 clients resolve too. Z2FDTNDATAQYW2 is CloudFront's fixed hosted zone id,
# surfaced via the module output.
resource "aws_route53_record" "media_cdn_a" {
  count   = local.media_domain_enabled ? 1 : 0
  zone_id = data.aws_route53_zone.root[0].zone_id
  name    = local.media_cdn_domain
  type    = "A"

  alias {
    name                   = module.media_cdn.distribution_domain_name
    zone_id                = module.media_cdn.distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "media_cdn_aaaa" {
  count   = local.media_domain_enabled ? 1 : 0
  zone_id = data.aws_route53_zone.root[0].zone_id
  name    = local.media_cdn_domain
  type    = "AAAA"

  alias {
    name                   = module.media_cdn.distribution_domain_name
    zone_id                = module.media_cdn.distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

# =============================================================================
# Uptime: Route53 health check against the API /health endpoint
# =============================================================================

resource "aws_route53_health_check" "api" {
  count             = var.enable_api_custom_domain ? 1 : 0
  fqdn              = "api.areacode.co.za"
  port              = 443
  type              = "HTTPS"
  resource_path     = "/health"
  failure_threshold = 3
  request_interval  = 30
  measure_latency   = true

  tags = {
    Name        = "area-code-${local.env}-api-health"
    Environment = local.env
  }
}

resource "aws_cloudwatch_metric_alarm" "api_health" {
  count               = var.enable_api_custom_domain ? 1 : 0
  alarm_name          = "area-code-${local.env}-api-health"
  alarm_description   = "api.areacode.co.za /health is failing"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HealthCheckStatus"
  namespace           = "AWS/Route53"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  # Route53 health checks publish metrics only to us-east-1
  dimensions = {
    HealthCheckId = aws_route53_health_check.api[0].id
  }
}

# --- CloudWatch alarms ---
resource "aws_sns_topic" "alerts" {
  name = "area-code-${local.env}-alerts"
}

# Email subscription so alarms reach a human instead of firing into the void.
# Same address the budget already notifies. The subscription stays "pending
# confirmation" until the confirmation link in the first email is clicked.
resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alerts_email
}

# Alarm: API Lambda errors > 5 in 5 minutes
resource "aws_cloudwatch_metric_alarm" "api_errors" {
  alarm_name          = "area-code-${local.env}-api-errors"
  alarm_description   = "API Lambda had more than 5 errors in a 5 minute window"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    FunctionName = module.lambda_api.function_name
  }
}

# Alarm: API Lambda p99 duration > 10s (cold-start or DynamoDB regression)
resource "aws_cloudwatch_metric_alarm" "api_duration_p99" {
  alarm_name          = "area-code-${local.env}-api-duration-p99"
  alarm_description   = "API Lambda p99 duration above 10 seconds"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  extended_statistic  = "p99"
  threshold           = 10000
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    FunctionName = module.lambda_api.function_name
  }
}

# Alarm: API Lambda throttles > 0
resource "aws_cloudwatch_metric_alarm" "api_throttles" {
  alarm_name          = "area-code-${local.env}-api-throttles"
  alarm_description   = "API Lambda is being throttled"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    FunctionName = module.lambda_api.function_name
  }
}

# DynamoDB table-level alarms (ThrottledRequests and SystemErrors)
locals {
  dynamo_tables = {
    users      = aws_dynamodb_table.users.name
    nodes      = aws_dynamodb_table.nodes.name
    checkins   = aws_dynamodb_table.checkins.name
    rewards    = aws_dynamodb_table.rewards.name
    businesses = aws_dynamodb_table.businesses.name
    app_data   = aws_dynamodb_table.app_data.name
  }
}

resource "aws_cloudwatch_metric_alarm" "dynamo_throttles" {
  for_each = local.dynamo_tables

  alarm_name          = "area-code-${local.env}-dynamo-${each.key}-throttles"
  alarm_description   = "DynamoDB table ${each.value} is being throttled"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ThrottledRequests"
  namespace           = "AWS/DynamoDB"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    TableName = each.value
  }
}

resource "aws_cloudwatch_metric_alarm" "dynamo_system_errors" {
  for_each = local.dynamo_tables

  alarm_name          = "area-code-${local.env}-dynamo-${each.key}-system-errors"
  alarm_description   = "DynamoDB table ${each.value} returned system errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "SystemErrors"
  namespace           = "AWS/DynamoDB"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    TableName = each.value
  }
}

# SQS dead-letter queue alarms — any message in a DLQ is a failed delivery
resource "aws_cloudwatch_metric_alarm" "sqs_reward_eval_dlq" {
  alarm_name          = "area-code-${local.env}-sqs-reward-eval-dlq"
  alarm_description   = "Messages landed in the reward-eval DLQ"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    QueueName = "area-code-${local.env}-reward-eval-dlq"
  }
}

# Booster business alarms (booster-pricing-floor-and-audit R9.5, R9.6, R9.7)
# Both metrics are emitted only on the actual event — no zero-count heartbeat,
# so `notBreaching` is the safe default for missing-data treatment.
#
# BoostFloorViolation: any rejected booster checkout under static-pricing
# implies client tampering or a misconfigured floor. One incident is enough.
resource "aws_cloudwatch_metric_alarm" "boost_floor_violation" {
  alarm_name          = "area-code-${local.env}-boost-floor-violation"
  alarm_description   = "A booster checkout was rejected for being below the configured floor"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "BoostFloorViolation"
  namespace           = "AreaCode/Business"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# BoostPurchaseAuditMissing: a payment.succeeded webhook landed but the
# BoosterPurchase audit row could not be persisted. Yoco will retry; one
# incident is still worth a page because the row is legally required.
resource "aws_cloudwatch_metric_alarm" "boost_purchase_audit_missing" {
  alarm_name          = "area-code-${local.env}-boost-purchase-audit-missing"
  alarm_description   = "A booster payment.succeeded event failed to persist its BoosterPurchase audit row"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "BoostPurchaseAuditMissing"
  namespace           = "AreaCode/Business"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# --- Budget alert ---
resource "aws_budgets_budget" "monthly" {
  name         = "area-code-${local.env}-monthly"
  budget_type  = "COST"
  limit_amount = "100" # Lowered for serverless
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alerts_email]
  }
}

# --- Amplify domains ---
module "amplify_domain_web" {
  source         = "../../modules/amplify-domain"
  env            = local.env
  amplify_app_id = "d3pm78r41ma6w6"
  domain_name    = "areacode.co.za"

  sub_domains = [
    { branch_name = "master", prefix = "" },
    { branch_name = "master", prefix = "www" }
  ]
}

module "amplify_domain_admin" {
  source         = "../../modules/amplify-domain"
  env            = local.env
  amplify_app_id = "d1ay6jict0ql9w"
  domain_name    = "areacode.co.za"

  sub_domains = [
    { branch_name = "master", prefix = "admin" }
  ]
}

module "amplify_domain_business" {
  source         = "../../modules/amplify-domain"
  env            = local.env
  amplify_app_id = "dbp54yxhyjvk0"
  domain_name    = "areacode.co.za"

  sub_domains = [
    { branch_name = "master", prefix = "business" }
  ]
}

module "amplify_domain_staff" {
  source         = "../../modules/amplify-domain"
  env            = local.env
  amplify_app_id = "d166bb81tg4k61"
  domain_name    = "areacode.co.za"

  sub_domains = [
    { branch_name = "master", prefix = "staff" }
  ]
}

# --- CloudWatch RUM (frontend error/perf monitoring) ---
# Pay-per-event ($1 / 100k events). Cookies disabled at SDK level so no
# consent banner is required under POPIA. See module docs for details.
module "rum" {
  source = "../../modules/cloudwatch-rum"
  env    = local.env

  monitors = {
    web = {
      domain              = "areacode.co.za"
      additional_domains  = ["www.areacode.co.za"]
      session_sample_rate = 1.0 # capture every session pre-launch
    }
    business = {
      domain              = "business.areacode.co.za"
      additional_domains  = []
      session_sample_rate = 1.0
    }
    staff = {
      domain              = "staff.areacode.co.za"
      additional_domains  = []
      session_sample_rate = 1.0
    }
    admin = {
      domain              = "admin.areacode.co.za"
      additional_domains  = []
      session_sample_rate = 1.0
    }
  }
}

# --- Outputs ---
output "api_endpoint" {
  value = module.api_gateway.api_endpoint
}

output "dynamodb_tables" {
  value = {
    users      = aws_dynamodb_table.users.name
    nodes      = aws_dynamodb_table.nodes.name
    checkins   = aws_dynamodb_table.checkins.name
    rewards    = aws_dynamodb_table.rewards.name
    businesses = aws_dynamodb_table.businesses.name
    app_data   = aws_dynamodb_table.app_data.name
  }
}

output "cognito_consumer_pool_id" {
  value = aws_cognito_user_pool.consumer_v2.id
}

output "cognito_business_pool_id" {
  value = module.cognito_business.user_pool_id
}

output "cognito_staff_pool_id" {
  value = module.cognito_staff.user_pool_id
}

output "cognito_admin_pool_id" {
  value = module.cognito_admin.user_pool_id
}

output "media_bucket" {
  value = module.s3_media.bucket_name
}

output "media_cdn_url" {
  value = module.media_cdn.media_cdn_url
}

output "sqs_reward_eval_url" {
  value = module.sqs_reward_eval.queue_url
}

output "sqs_report_generation_url" {
  value = module.sqs_report_generation.queue_url
}

output "sns_alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "api_custom_domain" {
  value       = var.enable_api_custom_domain ? "https://api.areacode.co.za" : null
  description = "Custom API domain (null when enable_api_custom_domain=false)"
}

# --- WebSocket API Gateway + Lambda ---
module "lambda_websocket" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "websocket"
  handler       = "index.handler"
  timeout       = 10
  memory_size   = 256
  environment_variables = {
    AREA_CODE_ENV     = local.env
    CONNECTIONS_TABLE = "area-code-${local.env}-websocket-connections"
    # WEBSOCKET_ENDPOINT is set post-deploy via deploy script (avoids circular dep)
    # Cognito pool/client IDs so $connect can verify bearer tokens. Mirrors the
    # API Lambda block's sources exactly (verifyBearerToken/getPoolConfig read
    # these lazily; fail-closed if absent). Without them the socket 502s.
    # Consumer is pinned to the v2 pool via locals, matching the API block.
    AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID = local.consumer_pool_id
    AREA_CODE_COGNITO_CONSUMER_CLIENT_ID    = local.consumer_client_id
    AREA_CODE_COGNITO_BUSINESS_USER_POOL_ID = module.cognito_business.user_pool_id
    AREA_CODE_COGNITO_BUSINESS_CLIENT_ID    = module.cognito_business.client_id
    AREA_CODE_COGNITO_STAFF_USER_POOL_ID    = module.cognito_staff.user_pool_id
    AREA_CODE_COGNITO_STAFF_CLIENT_ID       = module.cognito_staff.client_id
    AREA_CODE_COGNITO_ADMIN_USER_POOL_ID    = module.cognito_admin.user_pool_id
    AREA_CODE_COGNITO_ADMIN_CLIENT_ID       = module.cognito_admin.client_id
    # verifyBearerToken resolves identities from DynamoDB when the JWT lacks
    # custom claims: users (consumer), businesses (business), app-data (staff).
    # Missing vars crash requireEnv at $connect in prod (2026-07-10 go-live FAIL).
    USERS_TABLE      = aws_dynamodb_table.users.name
    BUSINESSES_TABLE = aws_dynamodb_table.businesses.name
    APP_DATA_TABLE   = aws_dynamodb_table.app_data.name
    # The auth middleware's import of business/repository.ts requires the salt
    # at module load; without it the bundle crashes at cold start (Uncaught
    # Exception, observed 2026-07-10) and every route 502s.
    AREA_CODE_ANONYMIZATION_SALT = var.anonymization_salt
  }
}

module "websocket" {
  source               = "../../modules/websocket"
  env                  = local.env
  lambda_function_arn  = module.lambda_websocket.function_arn
  lambda_function_name = module.lambda_websocket.function_name
  lambda_invoke_arn    = module.lambda_websocket.invoke_arn
  lambda_role_name     = module.lambda_websocket.role_name
}

output "websocket_api_endpoint" {
  value = module.websocket.websocket_api_endpoint
}

# CloudWatch RUM: per-monitor SDK config consumed by the frontend.
# scripts/update-all-amplify-apps.ps1 reads these and pushes the matching
# VITE_RUM_* env vars to each Amplify app.
output "rum_monitors" {
  value       = module.rum.monitors
  description = "RUM app monitor IDs and identity pool IDs, keyed by app (web, business, staff, admin)."
}
