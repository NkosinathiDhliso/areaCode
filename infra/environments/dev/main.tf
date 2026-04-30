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

# --- VPC (kept for Lambda VPC access — VPC itself is free) ---
module "vpc" {
  source             = "../../modules/vpc"
  env                = local.env
  enable_nat_gateway = false
}

# =============================================================================
# Cognito (4 pools + CUSTOM_AUTH triggers for consumer/business/staff)
# =============================================================================

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
  source    = "../../modules/cognito"
  env       = local.env
  pool_name = "admin"
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

# =============================================================================
# Lambda functions
# =============================================================================

# Monolith API Lambda — serves all Fastify routes via API Gateway catch-all
module "lambda_api" {
  source                 = "../../modules/lambda"
  env                    = local.env
  function_name          = "api"
  handler                = "index.handler"
  timeout                = 30
  memory_size            = 512
  lambda_in_vpc          = true
  vpc_subnet_ids         = module.vpc.private_subnet_ids
  vpc_security_group_ids = module.vpc.lambda_security_group_ids
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
    AREA_CODE_SQS_PUSH_QUEUE_URL            = module.sqs_push_sender.queue_url
    AREA_CODE_CONSENT_VERSION               = "v1.0"
  }
}

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

module "lambda_run_migration" {
  source                 = "../../modules/lambda"
  env                    = local.env
  function_name          = "run-migration"
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
    AREA_CODE_ENV    = local.env
    BUSINESSES_TABLE = aws_dynamodb_table.businesses.name
  }
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
