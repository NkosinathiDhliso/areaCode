# SERVERLESS VERSION of prod/main.tf
# This file shows which modules to KEEP vs REMOVE for cost savings
# Copy relevant sections to infra/environments/prod/main.tf

# =============================================================================
# KEEP THESE MODULES (Low/Variable Cost - Essential)
# =============================================================================

# VPC - Required for Lambda VPC access (keep but check NAT Gateways)
module "vpc" {
  source = "../../modules/vpc"
  env    = local.env
}

# Cognito - User pools (~$0 for < 10,000 MAU)
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

# Cognito Lambda triggers
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

# S3 - Media bucket (cheap storage)
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

# Lambda functions - Pay per invocation (~$0.20/million requests)
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

module "lambda_yoco_webhook" {
  source        = "../../modules/lambda"
  env           = local.env
  function_name = "yoco-webhook"
  timeout       = 30
  environment_variables = {
    AREA_CODE_ENV = local.env
  }
}

# SQS Queues (cheap - ~$0.40/million requests)
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

# API Gateway HTTP API (cheaper than REST API, ~$1/million requests)
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

# EventBridge Schedules (free tier: 1M invocations/month)
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

# =============================================================================
# REMOVE/COMMENT OUT THESE MODULES (High Fixed Costs)
# =============================================================================

# ❌ ECS Service - $50-70/month always (2 Fargate tasks)
# module "ecs_api" {
#   source             = "../../modules/ecs-service"
#   env                = local.env
#   service_name       = "api"
#   desired_count      = 2
#   cpu                = 512
#   memory             = 1024
#   ...
# }

# ❌ RDS PostgreSQL - $70-80/month always (db.t4g.medium multi-AZ)
# module "rds" {
#   source                 = "../../modules/rds"
#   env                    = local.env
#   instance_class         = "db.t4g.medium"
#   multi_az               = true
#   ...
# }

# ❌ ElastiCache Redis - $40-60/month always (2x cache.t4g.small)
# module "elasticache" {
#   source             = "../../modules/elasticache"
#   env                = local.env
#   node_type          = "cache.t4g.small"
#   num_cache_clusters = 2
#   ...
# }

# ❌ WAF - $20-30/month (base + rules)
# module "waf" {
#   source  = "../../modules/waf"
#   env     = local.env
#   alb_arn = module.ecs_api.alb_arn
# }

# =============================================================================
# COST COMPARISON
# =============================================================================
#
# BEFORE (Current):
#   ECS Fargate (2 tasks):     ~$60/month
#   RDS (db.t4g.medium multiAZ): ~$70/month
#   ElastiCache (2 nodes):       ~$50/month
#   ALB:                         ~$20/month
#   NAT Gateway (x2):            ~$70/month
#   WAF:                         ~$25/month
#   -----------------------------------------
#   TOTAL:                       ~$295/month
#
# AFTER (Serverless):
#   Lambda (low traffic):        ~$5/month
#   DynamoDB (on-demand):          ~$0-10/month
#   S3 (small storage):            ~$1/month
#   API Gateway HTTP:              ~$3/month
#   Secrets Manager:               ~$2/month
#   Cognito (<10K MAU):            ~$0
#   -----------------------------------------
#   TOTAL:                       ~$10-20/month
#
# SAVINGS: ~93% reduction ($275+/month saved)
#
# =============================================================================
