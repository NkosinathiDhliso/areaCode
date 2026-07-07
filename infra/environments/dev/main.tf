terraform {
  required_version = ">= 1.5.0"

  backend "s3" {
    bucket         = "area-code-terraform-state"
    key            = "dev/terraform.tfstate"
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
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}

locals {
  env = "dev"
}

# Declared for parity with prod: deploy-serverless.ps1 passes -var git_sha for
# every environment. Dev does not wire it anywhere yet.
variable "git_sha" {
  description = "Git commit SHA for release tracking"
  type        = string
  default     = "unknown"
}

# --- VPC (kept for Lambda VPC access — VPC itself is free) ---
module "vpc" {
  source             = "../../modules/vpc"
  env                = local.env
  enable_nat_gateway = false
}

# =============================================================================
# Cognito (4 pools + CUSTOM_AUTH triggers for consumer/business/staff)
# =============================================================================

# Email/password is the supported live auth path (phone OTP is dead). The
# backend signs in via AdminInitiateAuth ADMIN_USER_PASSWORD_AUTH, so every
# pool's app client must enable that flow. Kept in sync with prod.
locals {
  email_password_auth_flows = [
    "ALLOW_ADMIN_USER_PASSWORD_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
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
}

module "cognito_admin" {
  source              = "../../modules/cognito"
  env                 = local.env
  pool_name           = "admin"
  username_attributes = ["email"]
  # Dev keeps MFA OPTIONAL so local/force-live testing isn't blocked by an
  # authenticator enrolment. Prod enforces it ("ON"). The backend's DEV_MODE
  # bypasses the challenge entirely for ordinary dev runs.
  mfa_configuration = "OPTIONAL"
  explicit_auth_flows = [
    "ALLOW_ADMIN_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
  custom_attributes = [{
    name = "admin_role"
    type = "String"
  }]
}

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

# =============================================================================
# SMS (End User Messaging v2)
# =============================================================================

module "sms" {
  source    = "../../modules/sms"
  env       = local.env
  sender_id = "AREACODE"
}

# =============================================================================
# S3
# =============================================================================

module "s3_media" {
  source = "../../modules/s3"
  env    = local.env
  allowed_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "https://master.d3pm78r41ma6w6.amplifyapp.com",
    "https://master.dbp54yxhyjvk0.amplifyapp.com",
    "https://master.d166bb81tg4k61.amplifyapp.com",
    "https://master.d1ay6jict0ql9w.amplifyapp.com",
  ]
}

# =============================================================================
# DynamoDB (PAY_PER_REQUEST — scales to zero, mirrors prod schema)
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

  # People search (add-a-friend). See prod/main.tf for the full rationale:
  # sparse, char-bucketed prefix indexes on username / display name that
  # replace the users-table Scan.
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
  attribute {
    name = "nodeId"
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

# =============================================================================
# Lambda functions
# =============================================================================

# Monolith API Lambda — serves all Fastify routes via API Gateway catch-all
# Lambdas run outside the VPC: it has no NAT (banned, serverless-only.md) and
# no DynamoDB gateway endpoint, so an in-VPC Lambda has no route to DynamoDB or
# public HTTPS - every call hung to timeout (found 2026-07-05 in prod).
module "lambda_api" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "api"
  handler       = "index.handler"
  timeout       = 30
  memory_size   = 512
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
    # per-env convention so each env references its own table, never a cross-env one.
    PRESENCE_TABLE                          = "area-code-${local.env}-presence"
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
    AREA_CODE_SQS_PUSH_QUEUE_URL            = module.sqs_push_sender.queue_url
    AREA_CODE_CONSENT_VERSION               = "v1.0"
    # Win-back campaigns: the API async-invokes this dispatcher on send-now.
    AREA_CODE_CAMPAIGN_DISPATCHER_FUNCTION = module.lambda_campaign_dispatcher.function_name
  }
}

module "lambda_reward_evaluator" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "reward-evaluator"
  timeout       = 30
  memory_size   = 256
  environment_variables = {
    AREA_CODE_ENV = local.env
  }
}

module "lambda_pulse_decay" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "pulse-decay"
  timeout       = 120
  memory_size   = 256
  environment_variables = {
    AREA_CODE_ENV = local.env
    USERS_TABLE   = aws_dynamodb_table.users.name
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
  # Dev has no VAPID keys configured, so web push is a no-op here (sendWebPush
  # returns early); the reminder still writes to the notification center.
  environment_variables = {
    AREA_CODE_ENV  = local.env
    USERS_TABLE    = aws_dynamodb_table.users.name
    CHECKINS_TABLE = aws_dynamodb_table.checkins.name
    APP_DATA_TABLE = aws_dynamodb_table.app_data.name
  }
}

module "lambda_leaderboard_reset" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "leaderboard-reset"
  timeout       = 120
  memory_size   = 256
  environment_variables = {
    AREA_CODE_ENV = local.env
  }
}

module "lambda_partition_manager" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "partition-manager"
  timeout       = 60
  environment_variables = {
    AREA_CODE_ENV = local.env
  }
}

module "lambda_cleanup" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "cleanup"
  timeout       = 120
  memory_size   = 256
  environment_variables = {
    AREA_CODE_ENV = local.env
  }
}

module "lambda_run_migration" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "run-migration"
  timeout       = 120
  memory_size   = 256
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
    AREA_CODE_ENV    = local.env
    BUSINESSES_TABLE = aws_dynamodb_table.businesses.name
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
    AREA_CODE_ANONYMIZATION_SALT = "report-anonymization-salt-dev"
  }
}

# Win-back campaign dispatcher Lambda — async-invoked by the API on send-now;
# resolves the audience segment, applies consent/opt-out + frequency-cap +
# quota filters, then fans batches of <=100 recipients out to the campaign-send
# queue. (Mirrors the reports dispatcher pattern.)
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
# push (existing push-sender queue) and/or email (SES), and writes one
# anonymized send record per recipient. (Mirrors the reports generator pattern.)
module "lambda_campaign_sender" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "campaign-sender"
  timeout       = 120
  memory_size   = 512
  environment_variables = {
    AREA_CODE_ENV                = local.env
    USERS_TABLE                  = aws_dynamodb_table.users.name
    BUSINESSES_TABLE             = aws_dynamodb_table.businesses.name
    APP_DATA_TABLE               = aws_dynamodb_table.app_data.name
    AREA_CODE_SQS_PUSH_QUEUE_URL = module.sqs_push_sender.queue_url
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
  }
}

# Lambda IAM: schedule-transition-tick reads MusicSchedules (GSI + base),
# Nodes (BusinessIndex), CheckIns (per-venue GSI), and appData (city row);
# updates Nodes for the `lastArchetypeId` cache; publishes archetype-change
# deltas via the WebSocket API management plane. Least-privilege per R11.5.
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

# WebSocket Lambda
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
  }
}

# =============================================================================
# Lambda IAM — DynamoDB access for all Lambdas
# =============================================================================

resource "aws_iam_role_policy" "lambda_dynamodb" {
  for_each = {
    api               = module.lambda_api.role_name
    pulse_decay       = module.lambda_pulse_decay.role_name
    yoco_webhook      = module.lambda_yoco_webhook.role_name
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
        "dynamodb:Scan"
      ]
      Resource = [
        aws_dynamodb_table.users.arn,
        aws_dynamodb_table.nodes.arn,
        aws_dynamodb_table.checkins.arn,
        aws_dynamodb_table.rewards.arn,
        aws_dynamodb_table.businesses.arn,
        aws_dynamodb_table.app_data.arn,
        aws_dynamodb_table.presence.arn,
        "${aws_dynamodb_table.users.arn}/index/*",
        "${aws_dynamodb_table.nodes.arn}/index/*",
        "${aws_dynamodb_table.checkins.arn}/index/*",
        "${aws_dynamodb_table.rewards.arn}/index/*",
        "${aws_dynamodb_table.businesses.arn}/index/*",
        "${aws_dynamodb_table.app_data.arn}/index/*",
        "${aws_dynamodb_table.presence.arn}/index/*"
      ]
    }]
  })
}

# Lambda IAM: report-dispatcher -> DynamoDB read (businesses, nodes, checkins)
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

# Lambda IAM: report-dispatcher -> SQS send (report-generation queue)
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

# Lambda IAM: report-generator -> DynamoDB read/write (all tables)
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

# Lambda IAM: report-generator -> SQS receive/delete (report-generation queue) + send (push-sender queue)
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

# Lambda IAM: report-generator -> WebSocket API management (send notifications)
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

# Lambda IAM: campaign-dispatcher -> DynamoDB (read users/nodes/checkins/businesses, read+write app-data for counts/quota/freq-cap)
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
        "dynamodb:Scan"
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

# Lambda IAM: campaign-dispatcher -> SQS send (campaign-send queue)
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

# Lambda IAM: campaign-sender -> DynamoDB (read users/businesses, read+write app-data for send records + freq-cap)
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

# Lambda IAM: campaign-sender -> SQS receive/delete (campaign-send queue) + send (push-sender queue)
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
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = [module.sqs_push_sender.queue_arn]
      }
    ]
  })
}

# Lambda IAM: campaign-sender -> SES (campaign email delivery)
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

# Lambda IAM: API Lambda -> Cognito
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
        "cognito-idp:AdminUserGlobalSignOut",
        "cognito-idp:AdminSetUserMFAPreference",
        "cognito-idp:AssociateSoftwareToken",
        "cognito-idp:VerifySoftwareToken",
        "cognito-idp:SetUserMFAPreference",
        "cognito-idp:ListUsers"
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

# Lambda IAM: API Lambda -> SMS feedback
resource "aws_iam_role_policy" "api_sms_feedback" {
  name = "sms-feedback"
  role = module.lambda_api.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "SMSMessageFeedback"
        Effect   = "Allow"
        Action   = ["sms-voice:PutMessageFeedback"]
        Resource = "*"
      },
    ]
  })
}

# Lambda IAM: API -> SQS send
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

# Lambda IAM: API -> campaign-dispatcher async invoke (win-back send-now)
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

# Lambda IAM: API -> SES (transactional email: verification, password reset, etc.)
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

# Lambda IAM: reward-evaluator -> SQS
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

# =============================================================================
# SQS Queues
# =============================================================================

module "sqs_reward_eval" {
  source                = "../../modules/sqs"
  env                   = local.env
  queue_name            = "reward-eval"
  visibility_timeout    = 60
  lambda_function_arn   = module.lambda_reward_evaluator.function_arn
  enable_lambda_mapping = true
}

module "sqs_push_sender" {
  source             = "../../modules/sqs"
  env                = local.env
  queue_name         = "push-sender"
  visibility_timeout = 30
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

# =============================================================================
# EventBridge Schedules
# =============================================================================

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
      description          = "Weekly leaderboard reset Monday 00:00 SAST (Sunday 22:00 UTC)"
      schedule_expression  = "cron(0 22 ? * SUN *)"
      lambda_arn           = module.lambda_leaderboard_reset.function_arn
      lambda_function_name = module.lambda_leaderboard_reset.function_name
    }
    partition-manager = {
      description          = "Check-in table partition management daily at 03:00 SAST (01:00 UTC)"
      schedule_expression  = "cron(0 1 * * ? *)"
      lambda_arn           = module.lambda_partition_manager.function_arn
      lambda_function_name = module.lambda_partition_manager.function_name
    }
    cleanup = {
      description          = "Cleanup expired tokens/data daily at 04:00 SAST (02:00 UTC)"
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
      description          = "Monthly intelligence report generation 1st of month 06:00 SAST (04:00 UTC)"
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

# =============================================================================
# API Gateway — catch-all monolith + yoco webhook override
# =============================================================================

module "api_gateway" {
  source = "../../modules/api-gateway"
  env    = local.env

  additional_cors_origins = [
    "https://master.d3pm78r41ma6w6.amplifyapp.com",
    "https://master.dbp54yxhyjvk0.amplifyapp.com",
    "https://master.d166bb81tg4k61.amplifyapp.com",
    "https://master.d1ay6jict0ql9w.amplifyapp.com",
  ]

  # The `$default` catch-all routes every HTTP path (including all
  # `/v1/business/{businessId}/music-schedule[/...]` schedule-CRUD routes
  # added in the live-vibe-on-map spec, task 7.3) into the Fastify
  # monolith. New backend routes that live inside `lambda_api` therefore
  # do NOT require additional IaC entries here — they are picked up by
  # Fastify's router at runtime. The only per-route override below is
  # the Yoco webhook, which targets a different Lambda.
  lambda_integrations = {
    api_catchall = {
      invoke_arn = module.lambda_api.invoke_arn
      route_key  = "$default"
    }
    yoco_webhook = {
      invoke_arn = module.lambda_yoco_webhook.invoke_arn
      route_key  = "POST /v1/webhooks/yoco"
    }
  }
}

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
# WebSocket API Gateway
# =============================================================================

module "websocket" {
  source               = "../../modules/websocket"
  env                  = local.env
  lambda_function_arn  = module.lambda_websocket.function_arn
  lambda_function_name = module.lambda_websocket.function_name
  lambda_invoke_arn    = module.lambda_websocket.invoke_arn
  lambda_role_name     = module.lambda_websocket.role_name
}

# =============================================================================
# Budget alert ($50 for dev)
# =============================================================================

resource "aws_budgets_budget" "monthly" {
  name         = "area-code-${local.env}-monthly"
  budget_type  = "COST"
  limit_amount = "50"
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

# =============================================================================
# Outputs
# =============================================================================

output "api_endpoint" {
  value = module.api_gateway.api_endpoint
}

output "websocket_api_endpoint" {
  value = module.websocket.websocket_api_endpoint
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

output "vpc_id" {
  value = module.vpc.vpc_id
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
