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

# --- Data sources for secrets ---
data "aws_secretsmanager_secret" "db_url" {
  name = "area-code/${local.env}/db-url"
}

data "aws_secretsmanager_secret" "redis_url" {
  name = "area-code/${local.env}/redis-url"
}

data "aws_secretsmanager_secret" "qr_hmac" {
  name = "area-code/${local.env}/qr-hmac-secret"
}

data "aws_secretsmanager_secret" "sentry_dsn" {
  name = "area-code/${local.env}/sentry-dsn"
}

# --- VPC / Networking (NAT disabled — using VPC endpoints to save ~$32/mo) ---
module "vpc" {
  source             = "../../modules/vpc"
  env                = local.env
  enable_nat_gateway = false
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

# --- Cognito CUSTOM_AUTH Lambda triggers (consumer, business, staff) ---
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
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003"
  ]
}

# --- RDS ---
module "rds" {
  source                 = "../../modules/rds"
  env                    = local.env
  instance_class         = "db.t4g.micro"
  multi_az               = false
  vpc_security_group_ids = module.vpc.db_security_group_ids
  subnet_group_name      = module.vpc.db_subnet_group_name
}

# --- ElastiCache (Redis) ---
module "elasticache" {
  source             = "../../modules/elasticache"
  env                = local.env
  node_type          = "cache.t4g.micro"
  num_cache_clusters = 1
  subnet_group_name  = module.vpc.elasticache_subnet_group_name
  security_group_ids = module.vpc.redis_security_group_ids
}

# --- Lambda functions (no provisioned concurrency in dev to save ~$40/mo) ---
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
    AREA_CODE_ENV = local.env
  }
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

# --- Lambda IAM: check-in → SQS send ---
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

# --- Lambda IAM: reward-evaluator → SQS receive + push queue send ---
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

# --- Lambda IAM: ECS task → SQS send ---
resource "aws_iam_role_policy" "ecs_sqs_send" {
  name = "sqs-send"
  role = module.ecs_api.task_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = [module.sqs_reward_eval.queue_arn, module.sqs_push_sender.queue_arn]
    }]
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

# --- API Gateway (with Lambda integrations) ---
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

# --- Lambda → API Gateway permissions ---
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

# --- ECS (API server for WebSocket / long-running) ---
module "ecs_api" {
  source             = "../../modules/ecs-service"
  env                = local.env
  service_name       = "api"
  desired_count      = 1
  cpu                = 256
  memory             = 512
  vpc_id             = module.vpc.vpc_id
  subnet_ids         = module.vpc.private_subnet_ids
  security_group_ids = module.vpc.ecs_security_group_ids
  environment_variables = {
    AREA_CODE_ENV                          = local.env
    NODE_ENV                               = "development"
    AWS_REGION                             = "us-east-1"
    AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID = module.cognito_consumer.user_pool_id
    AREA_CODE_COGNITO_CONSUMER_CLIENT_ID    = module.cognito_consumer.client_id
    AREA_CODE_COGNITO_BUSINESS_USER_POOL_ID = module.cognito_business.user_pool_id
    AREA_CODE_COGNITO_BUSINESS_CLIENT_ID    = module.cognito_business.client_id
    AREA_CODE_COGNITO_STAFF_USER_POOL_ID    = module.cognito_staff.user_pool_id
    AREA_CODE_COGNITO_STAFF_CLIENT_ID       = module.cognito_staff.client_id
    AREA_CODE_COGNITO_ADMIN_USER_POOL_ID    = module.cognito_admin.user_pool_id
    AREA_CODE_COGNITO_ADMIN_CLIENT_ID       = module.cognito_admin.client_id
    AREA_CODE_REWARD_QUEUE_URL              = module.sqs_reward_eval.queue_url
    AREA_CODE_S3_MEDIA_BUCKET               = "area-code-${local.env}-media"
    AREA_CODE_CONSENT_VERSION               = "v1.0"
  }
  secrets = {
    AREA_CODE_DB_URL         = data.aws_secretsmanager_secret.db_url.arn
    AREA_CODE_REDIS_URL      = data.aws_secretsmanager_secret.redis_url.arn
    AREA_CODE_QR_HMAC_SECRET = data.aws_secretsmanager_secret.qr_hmac.arn
    SENTRY_DSN               = data.aws_secretsmanager_secret.sentry_dsn.arn
  }
}

# --- WAF (attached to ALB — WAFv2 doesn't support HTTP API Gateway) ---
module "waf" {
  source  = "../../modules/waf"
  env     = local.env
  alb_arn = module.ecs_api.alb_arn
}

# --- VPC Endpoints (replaces NAT for AWS service access) ---
resource "aws_vpc_endpoint" "secretsmanager" {
  vpc_id              = module.vpc.vpc_id
  service_name        = "com.amazonaws.us-east-1.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = module.vpc.private_subnet_ids
  security_group_ids  = module.vpc.lambda_security_group_ids
  private_dns_enabled = true
}

resource "aws_vpc_endpoint" "logs" {
  vpc_id              = module.vpc.vpc_id
  service_name        = "com.amazonaws.us-east-1.logs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = module.vpc.private_subnet_ids
  security_group_ids  = module.vpc.lambda_security_group_ids
  private_dns_enabled = true
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id       = module.vpc.vpc_id
  service_name = "com.amazonaws.us-east-1.s3"
}

# --- Budget alert ---
resource "aws_budgets_budget" "monthly" {
  name         = "area-code-${local.env}-monthly"
  budget_type  = "COST"
  limit_amount = "500"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = ["[email]"]
  }
}

# --- Outputs ---
output "api_endpoint" {
  value = module.api_gateway.api_endpoint
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

output "rds_endpoint" {
  value = module.rds.primary_endpoint
}

output "redis_endpoint" {
  value = module.elasticache.primary_endpoint
}

output "ecs_api_url" {
  value = module.ecs_api.alb_dns_name
}

output "sqs_reward_eval_url" {
  value = module.sqs_reward_eval.queue_url
}

output "sqs_push_sender_url" {
  value = module.sqs_push_sender.queue_url
}
