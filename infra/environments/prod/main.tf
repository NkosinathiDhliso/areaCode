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

variable "git_sha" {
  description = "Git commit SHA for release tracking"
  type        = string
  default     = "unknown"
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

variable "sentry_dsn" {
  description = "Sentry DSN for backend error monitoring. Leave empty to disable Sentry."
  type        = string
  sensitive   = true
  default     = ""
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

# --- Data sources for secrets ---
data "aws_secretsmanager_secret" "qr_hmac" {
  name = "area-code/${local.env}/qr-hmac-secret"
}

data "aws_secretsmanager_secret_version" "qr_hmac" {
  secret_id = data.aws_secretsmanager_secret.qr_hmac.id
}

# --- VPC / Networking ---
module "vpc" {
  source             = "../../modules/vpc"
  env                = local.env
  enable_nat_gateway = false
}

# --- Cognito pools (4 separate pools) ---
module "cognito_consumer" {
  source                    = "../../modules/cognito"
  env                       = local.env
  pool_name                 = "consumer"
  define_auth_challenge_arn = module.cognito_triggers_consumer.define_auth_arn
  create_auth_challenge_arn = module.cognito_triggers_consumer.create_auth_arn
  verify_auth_challenge_arn = module.cognito_triggers_consumer.verify_auth_arn
}

module "cognito_business" {
  source                    = "../../modules/cognito"
  env                       = local.env
  pool_name                 = "business"
  define_auth_challenge_arn = module.cognito_triggers_business.define_auth_arn
  create_auth_challenge_arn = module.cognito_triggers_business.create_auth_arn
  verify_auth_challenge_arn = module.cognito_triggers_business.verify_auth_arn
}

module "cognito_staff" {
  source                    = "../../modules/cognito"
  env                       = local.env
  pool_name                 = "staff"
  access_token_ttl_hours    = 8
  define_auth_challenge_arn = module.cognito_triggers_staff.define_auth_arn
  create_auth_challenge_arn = module.cognito_triggers_staff.create_auth_arn
  verify_auth_challenge_arn = module.cognito_triggers_staff.verify_auth_arn
}

module "cognito_admin" {
  source              = "../../modules/cognito"
  env                 = local.env
  pool_name           = "admin"
  username_attributes = ["email"]
  explicit_auth_flows = [
    "ALLOW_ADMIN_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
  custom_attributes = [{
    name = "admin_role"
    type = "String"
  }]
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
    AREA_CODE_ENV                           = local.env
    USERS_TABLE                             = aws_dynamodb_table.users.name
    NODES_TABLE                             = aws_dynamodb_table.nodes.name
    CHECKINS_TABLE                          = aws_dynamodb_table.checkins.name
    REWARDS_TABLE                           = aws_dynamodb_table.rewards.name
    BUSINESSES_TABLE                        = aws_dynamodb_table.businesses.name
    APP_DATA_TABLE                          = aws_dynamodb_table.app_data.name
    AREA_CODE_REWARD_QUEUE_URL              = module.sqs_reward_eval.queue_url
    AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID = module.cognito_consumer.user_pool_id
    AREA_CODE_COGNITO_CONSUMER_CLIENT_ID    = module.cognito_consumer.client_id
    AREA_CODE_COGNITO_BUSINESS_USER_POOL_ID = module.cognito_business.user_pool_id
    AREA_CODE_COGNITO_BUSINESS_CLIENT_ID    = module.cognito_business.client_id
    AREA_CODE_COGNITO_STAFF_USER_POOL_ID    = module.cognito_staff.user_pool_id
    AREA_CODE_COGNITO_STAFF_CLIENT_ID       = module.cognito_staff.client_id
    AREA_CODE_COGNITO_ADMIN_USER_POOL_ID    = module.cognito_admin.user_pool_id
    AREA_CODE_COGNITO_ADMIN_CLIENT_ID       = module.cognito_admin.client_id
    AREA_CODE_S3_MEDIA_BUCKET               = module.s3_media.bucket_name
    # MEDIA_BUCKET kept as an alias for any code paths that still read the short name.
    MEDIA_BUCKET                 = module.s3_media.bucket_name
    AREA_CODE_SQS_PUSH_QUEUE_URL = module.sqs_push_sender.queue_url
    AREA_CODE_CONSENT_VERSION    = "v1.0"
    AREA_CODE_ANONYMIZATION_SALT = var.anonymization_salt
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
    # Error monitoring (no-op if sentry_dsn is empty)
    SENTRY_DSN = var.sentry_dsn
    GIT_SHA    = var.git_sha
  }
}

# Legacy per-route Lambdas (check-in, node-detail, rewards-near-me) were removed
# from production in May 2026. All routes are now served by the monolith API Lambda
# via the `$default` API Gateway integration. The archived Terraform blocks live in
# _archive/retired-high-cost-infra/ if historical reference is needed.

module "lambda_reward_evaluator" {
  source                 = "../../modules/lambda"
  env                    = local.env
  function_name          = "reward-evaluator"
  timeout                = 30
  memory_size            = 256
  lambda_in_vpc          = true
  vpc_subnet_ids         = module.vpc.private_subnet_ids
  vpc_security_group_ids = module.vpc.lambda_security_group_ids
  environment_variables = {
    AREA_CODE_ENV = local.env
  }
}

module "lambda_pulse_decay" {
  source                 = "../../modules/lambda"
  env                    = local.env
  function_name          = "pulse-decay"
  timeout                = 120
  memory_size            = 256
  lambda_in_vpc          = true
  vpc_subnet_ids         = module.vpc.private_subnet_ids
  vpc_security_group_ids = module.vpc.lambda_security_group_ids
  environment_variables = {
    AREA_CODE_ENV = local.env
    USERS_TABLE   = aws_dynamodb_table.users.name
  }
}

module "lambda_leaderboard_reset" {
  source                 = "../../modules/lambda"
  env                    = local.env
  function_name          = "leaderboard-reset"
  timeout                = 120
  memory_size            = 256
  lambda_in_vpc          = true
  vpc_subnet_ids         = module.vpc.private_subnet_ids
  vpc_security_group_ids = module.vpc.lambda_security_group_ids
  environment_variables = {
    AREA_CODE_ENV = local.env
  }
}

module "lambda_partition_manager" {
  source                 = "../../modules/lambda"
  env                    = local.env
  function_name          = "partition-manager"
  timeout                = 60
  lambda_in_vpc          = true
  vpc_subnet_ids         = module.vpc.private_subnet_ids
  vpc_security_group_ids = module.vpc.lambda_security_group_ids
  environment_variables = {
    AREA_CODE_ENV = local.env
  }
}

module "lambda_cleanup" {
  source                 = "../../modules/lambda"
  env                    = local.env
  function_name          = "cleanup"
  timeout                = 120
  memory_size            = 256
  lambda_in_vpc          = true
  vpc_subnet_ids         = module.vpc.private_subnet_ids
  vpc_security_group_ids = module.vpc.lambda_security_group_ids
  environment_variables = {
    AREA_CODE_ENV = local.env
  }
}

module "lambda_yoco_webhook" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "yoco-webhook"
  timeout       = 30
  environment_variables = {
    AREA_CODE_ENV       = local.env
    BUSINESSES_TABLE    = aws_dynamodb_table.businesses.name
    YOCO_WEBHOOK_SECRET = var.yoco_webhook_secret
  }
}

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
    AREA_CODE_SQS_PUSH_QUEUE_URL = module.sqs_push_sender.queue_url
    AREA_CODE_ANONYMIZATION_SALT = var.anonymization_salt
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
module "lambda_schedule_transition_tick" {
  source                 = "../../modules/lambda"
  env                    = local.env
  function_name          = "schedule-transition-tick"
  handler                = "index.handler"
  timeout                = 60
  memory_size            = 256
  lambda_in_vpc          = true
  vpc_subnet_ids         = module.vpc.private_subnet_ids
  vpc_security_group_ids = module.vpc.lambda_security_group_ids
  environment_variables = {
    AREA_CODE_ENV         = local.env
    MUSIC_SCHEDULES_TABLE = aws_dynamodb_table.music_schedules.name
    NODES_TABLE           = aws_dynamodb_table.nodes.name
    CHECKINS_TABLE        = aws_dynamodb_table.checkins.name
    APP_DATA_TABLE        = aws_dynamodb_table.app_data.name
    LIVE_VIBE_ON_MAP_FLAG = "false"
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
    yoco_webhook      = module.lambda_yoco_webhook.role_name
    reward_evaluator  = module.lambda_reward_evaluator.role_name
    leaderboard_reset = module.lambda_leaderboard_reset.role_name
    cleanup           = module.lambda_cleanup.role_name
    websocket         = module.lambda_websocket.role_name
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
        "dynamodb:Scan"
      ]
      Resource = [
        aws_dynamodb_table.users.arn,
        aws_dynamodb_table.nodes.arn,
        aws_dynamodb_table.checkins.arn,
        aws_dynamodb_table.rewards.arn,
        aws_dynamodb_table.businesses.arn,
        aws_dynamodb_table.app_data.arn,
        "${aws_dynamodb_table.users.arn}/index/*",
        "${aws_dynamodb_table.nodes.arn}/index/*",
        "${aws_dynamodb_table.checkins.arn}/index/*",
        "${aws_dynamodb_table.rewards.arn}/index/*",
        "${aws_dynamodb_table.businesses.arn}/index/*",
        "${aws_dynamodb_table.app_data.arn}/index/*"
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
        "cognito-idp:ListUsers",
        "cognito-idp:SignUp",
        "cognito-idp:InitiateAuth",
        "cognito-idp:RespondToAuthChallenge",
        "cognito-idp:GlobalSignOut"
      ]
      Resource = [
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
  source              = "../../modules/sqs"
  env                 = local.env
  queue_name          = "reward-eval"
  visibility_timeout  = 60
  lambda_function_arn = module.lambda_reward_evaluator.function_arn
}

module "sqs_push_sender" {
  source             = "../../modules/sqs"
  env                = local.env
  queue_name         = "push-sender"
  visibility_timeout = 30
}

module "sqs_report_generation" {
  source              = "../../modules/sqs"
  env                 = local.env
  queue_name          = "report-generation"
  visibility_timeout  = 150
  max_receive_count   = 2
  lambda_function_arn = module.lambda_report_generator.function_arn
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
      Resource = [module.sqs_reward_eval.queue_arn, module.sqs_push_sender.queue_arn]
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
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = module.sqs_push_sender.queue_arn
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
        "dynamodb:Scan"
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
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = [module.sqs_push_sender.queue_arn]
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
    # Specific routes kept as overrides for yoco webhook (different Lambda)
    yoco_webhook = {
      invoke_arn = module.lambda_yoco_webhook.invoke_arn
      route_key  = "POST /v1/webhooks/yoco"
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

resource "aws_lambda_permission" "apigw_yoco_webhook" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda_yoco_webhook.function_name
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

resource "aws_cloudwatch_metric_alarm" "sqs_push_sender_dlq" {
  alarm_name          = "area-code-${local.env}-sqs-push-sender-dlq"
  alarm_description   = "Messages landed in the push-sender DLQ"
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
    QueueName = "area-code-${local.env}-push-sender-dlq"
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
    subscriber_email_addresses = ["alerts@areacode.co.za"]
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

# --- CloudWatch RUM (frontend error/perf monitoring, replaces Sentry) ---
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
  value = module.cognito_consumer.user_pool_id
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

output "sqs_reward_eval_url" {
  value = module.sqs_reward_eval.queue_url
}

output "sqs_push_sender_url" {
  value = module.sqs_push_sender.queue_url
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
