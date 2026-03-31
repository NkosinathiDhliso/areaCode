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
}

module "cognito_business" {
  source    = "../../modules/cognito"
  env       = local.env
  pool_name = "business"
}

module "cognito_staff" {
  source                 = "../../modules/cognito"
  env                    = local.env
  pool_name              = "staff"
  access_token_ttl_hours = 8
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
    AREA_CODE_ENV = local.env
    NODE_ENV      = "development"
  }
  secrets = {
    DATABASE_URL = data.aws_secretsmanager_secret.db_url.arn
    REDIS_URL    = data.aws_secretsmanager_secret.redis_url.arn
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
