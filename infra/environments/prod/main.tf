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

# --- Data sources for secrets (some optional) ---
data "aws_secretsmanager_secret" "db_url" {
  name = "area-code/${local.env}/db-url"
}

data "aws_secretsmanager_secret" "redis_url" {
  name = "area-code/${local.env}/redis-url"
}

data "aws_secretsmanager_secret" "qr_hmac" {
  name = "area-code/${local.env}/qr-hmac-secret"
}

# --- VPC / Networking ---
module "vpc" {
  source = "../../modules/vpc"
  env    = local.env
}

# --- Cognito pools (4 separate pools) ---
module "cognito_consumer" {
  source    = "../../modules/cognito"
  env       = local.env
  pool_name = "consumer"
  define_auth_challenge_arn  = module.cognito_triggers_consumer.define_auth_arn
  create_auth_challenge_arn  = module.cognito_triggers_consumer.create_auth_arn
  verify_auth_challenge_arn  = module.cognito_triggers_consumer.verify_auth_arn
}

module "cognito_business" {
  source    = "../../modules/cognito"
  env       = local.env
  pool_name = "business"
  define_auth_challenge_arn  = module.cognito_triggers_business.define_auth_arn
  create_auth_challenge_arn  = module.cognito_triggers_business.create_auth_arn
  verify_auth_challenge_arn  = module.cognito_triggers_business.verify_auth_arn
}

module "cognito_staff" {
  source                 = "../../modules/cognito"
  env                    = local.env
  pool_name              = "staff"
  access_token_ttl_hours = 8
  define_auth_challenge_arn  = module.cognito_triggers_staff.define_auth_arn
  create_auth_challenge_arn  = module.cognito_triggers_staff.create_auth_arn
  verify_auth_challenge_arn  = module.cognito_triggers_staff.verify_auth_arn
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

  point_in_time_recovery { enabled = true }

  tags = { Environment = local.env }
}

# --- Lambda functions ---
module "lambda_check_in" {
  source                 = "../../modules/lambda"
  env                    = local.env
  function_name          = "check-in"
  timeout                = 10
  lambda_in_vpc          = true
  vpc_subnet_ids         = module.vpc.private_subnet_ids
  vpc_security_group_ids = module.vpc.lambda_security_group_ids
  environment_variables = {
    AREA_CODE_ENV = local.env
    USERS_TABLE   = aws_dynamodb_table.users.name
    NODES_TABLE   = aws_dynamodb_table.nodes.name
    CHECKINS_TABLE = aws_dynamodb_table.checkins.name
  }
}

module "lambda_node_detail" {
  source                 = "../../modules/lambda"
  env                    = local.env
  function_name          = "node-detail"
  timeout                = 10
  lambda_in_vpc          = true
  vpc_subnet_ids         = module.vpc.private_subnet_ids
  vpc_security_group_ids = module.vpc.lambda_security_group_ids
  environment_variables = {
    AREA_CODE_ENV = local.env
    NODES_TABLE   = aws_dynamodb_table.nodes.name
  }
}

module "lambda_rewards_near_me" {
  source                 = "../../modules/lambda"
  env                    = local.env
  function_name          = "rewards-near-me"
  timeout                = 10
  lambda_in_vpc          = true
  vpc_subnet_ids         = module.vpc.private_subnet_ids
  vpc_security_group_ids = module.vpc.lambda_security_group_ids
  environment_variables = {
    AREA_CODE_ENV = local.env
    REWARDS_TABLE = aws_dynamodb_table.rewards.name
    NODES_TABLE   = aws_dynamodb_table.nodes.name
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

module "lambda_yoco_webhook" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "yoco-webhook"
  timeout       = 30
  environment_variables = {
    AREA_CODE_ENV = local.env
    BUSINESSES_TABLE = aws_dynamodb_table.businesses.name
  }
}

# --- Lambda DynamoDB IAM permissions ---
resource "aws_iam_role_policy" "lambda_dynamodb" {
  for_each = {
    check_in        = module.lambda_check_in.role_name
    node_detail     = module.lambda_node_detail.role_name
    rewards_near_me = module.lambda_rewards_near_me.role_name
    pulse_decay     = module.lambda_pulse_decay.role_name
    yoco_webhook    = module.lambda_yoco_webhook.role_name
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

# --- Lambda IAM: check-in -> SQS send ---
resource "aws_iam_role_policy" "checkin_sqs_send" {
  name = "sqs-send"
  role = module.lambda_check_in.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = module.sqs_reward_eval.queue_arn
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
  }
}

# --- API Gateway ---
module "api_gateway" {
  source = "../../modules/api-gateway"
  env    = local.env

  lambda_integrations = {
    check_in = {
      invoke_arn = module.lambda_check_in.invoke_arn
      route_key  = "POST /v1/check-in"
    }
    node_detail = {
      invoke_arn = module.lambda_node_detail.invoke_arn
      route_key  = "GET /v1/nodes/{nodeId}"
    }
    rewards_near_me = {
      invoke_arn = module.lambda_rewards_near_me.invoke_arn
      route_key  = "GET /v1/rewards/near-me"
    }
    yoco_webhook = {
      invoke_arn = module.lambda_yoco_webhook.invoke_arn
      route_key  = "POST /v1/webhooks/yoco"
    }
  }
}

# --- Lambda -> API Gateway permissions ---
resource "aws_lambda_permission" "apigw_check_in" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda_check_in.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "apigw_node_detail" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda_node_detail.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "apigw_rewards_near_me" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda_rewards_near_me.function_name
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

# --- CloudWatch alarms ---
resource "aws_sns_topic" "alerts" {
  name = "area-code-${local.env}-alerts"
}

resource "aws_cloudwatch_metric_alarm" "checkin_errors" {
  alarm_name          = "area-code-${local.env}-checkin-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    FunctionName = module.lambda_check_in.function_name
  }
}

# --- Budget alert ---
resource "aws_budgets_budget" "monthly" {
  name         = "area-code-${local.env}-monthly"
  budget_type  = "COST"
  limit_amount = "100"  # Lowered for serverless
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

# --- Outputs ---
output "api_endpoint" {
  value = module.api_gateway.api_endpoint
}

output "dynamodb_tables" {
  value = {
    users     = aws_dynamodb_table.users.name
    nodes     = aws_dynamodb_table.nodes.name
    checkins  = aws_dynamodb_table.checkins.name
    rewards   = aws_dynamodb_table.rewards.name
    businesses = aws_dynamodb_table.businesses.name
    app_data  = aws_dynamodb_table.app_data.name
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

# --- WebSocket API (TODO: deploy after backend zip is built) ---
# module "websocket" {
#   source              = "../../modules/websocket"
#   env                 = local.env
#   lambda_function_arn = aws_lambda_function.websocket.arn
#   lambda_invoke_arn   = aws_lambda_function.websocket.invoke_arn
# }
#
# resource "aws_lambda_function" "websocket" {
#   function_name = "area-code-${local.env}-websocket"
#   role          = module.lambda_check_in.role_arn
#   handler       = "src/lambdas/websocket.handler"
#   runtime       = "nodejs20.x"
#   timeout       = 10
#   memory_size   = 256
#   filename         = "${path.module}/../../../backend/dist/websocket-lambda.zip"
#   source_code_hash = filebase64sha256("${path.module}/../../../backend/dist/websocket-lambda.zip")
# }
