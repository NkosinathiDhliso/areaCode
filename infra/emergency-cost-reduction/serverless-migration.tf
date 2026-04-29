# SERVERLESS MIGRATION - Replace expensive resources with pay-per-use alternatives
# This creates DynamoDB tables to replace RDS PostgreSQL and removes ElastiCache dependency

# =============================================================================
# DYNAMODB TABLES (Serverless database - pay per request, not uptime)
# =============================================================================

# Main application data - replaces PostgreSQL tables
resource "aws_dynamodb_table" "users" {
  name         = "area-code-${local.env}-users"
  billing_mode = "PAY_PER_REQUEST"  # Serverless - no hourly charges
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

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Environment = local.env
    Purpose     = "serverless-replacement"
  }
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

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Environment = local.env
    Purpose     = "serverless-replacement"
  }
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

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Environment = local.env
    Purpose     = "serverless-replacement"
  }
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

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Environment = local.env
    Purpose     = "serverless-replacement"
  }
}

# Single-table design for complex relationships
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

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Environment = local.env
    Purpose     = "serverless-replacement"
  }
}

# =============================================================================
# LAMBDA FUNCTION URLS (Replace ECS for simple HTTP endpoints)
# =============================================================================

# For stateless API endpoints that don't need WebSocket, use Lambda Function URLs
# They're free (only pay for invocations) vs ALB which costs ~$20/month base

# Example: Converting ECS health check to Lambda
resource "aws_lambda_function" "api_health" {
  function_name = "area-code-${local.env}-api-health"
  role          = aws_iam_role.lambda_api.arn
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  filename      = "lambda-placeholder.zip"  # Replace with actual build
  memory_size   = 128
  timeout       = 5

  environment {
    variables = {
      AREA_CODE_ENV = local.env
    }
  }
}

resource "aws_lambda_function_url" "api_health" {
  function_name      = aws_lambda_function.api_health.function_name
  authorization_type = "NONE"
}

resource "aws_iam_role" "lambda_api" {
  name = "area-code-${local.env}-lambda-api"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_dynamodb" {
  name = "dynamodb-access"
  role = aws_iam_role.lambda_api.name

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
        aws_dynamodb_table.app_data.arn,
        "${aws_dynamodb_table.users.arn}/index/*",
        "${aws_dynamodb_table.nodes.arn}/index/*",
        "${aws_dynamodb_table.checkins.arn}/index/*",
        "${aws_dynamodb_table.rewards.arn}/index/*",
        "${aws_dynamodb_table.app_data.arn}/index/*"
      ]
    }]
  })
}

# =============================================================================
# S3 FOR STATIC ASSETS & SESSIONS (Replace ElastiCache for non-critical cache)
# =============================================================================

# Use S3 with short TTL for cache-like data instead of ElastiCache
resource "aws_s3_bucket" "cache" {
  bucket = "area-code-${local.env}-cache-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_lifecycle_configuration" "cache_ttl" {
  bucket = aws_s3_bucket.cache.id

  rule {
    id     = "expire-cache-objects"
    status = "Enabled"

    expiration {
      days = 1  # Adjust based on cache needs
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }
}

resource "aws_s3_bucket_versioning" "cache" {
  bucket = aws_s3_bucket.cache.id
  versioning_configuration {
    status = "Disabled"  # Save costs - no versioning for cache
  }
}

# =============================================================================
# VPC ENDPOINTS (Optional - reduce NAT Gateway costs by using VPC endpoints)
# =============================================================================

# VPC endpoints allow Lambda/DynamoDB to communicate without NAT Gateway
resource "aws_vpc_endpoint" "dynamodb" {
  vpc_id            = module.vpc.vpc_id
  service_name      = "com.amazonaws.us-east-1.dynamodb"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = module.vpc.private_route_table_ids

  tags = {
    Name = "dynamodb-endpoint"
  }
}

# =============================================================================
# LOCALS AND DATA
# =============================================================================

locals {
  env = "prod"
}

data "aws_caller_identity" "current" {}

# =============================================================================
# OUTPUTS
# =============================================================================

output "dynamodb_tables" {
  value = {
    users     = aws_dynamodb_table.users.name
    nodes     = aws_dynamodb_table.nodes.name
    checkins  = aws_dynamodb_table.checkins.name
    rewards   = aws_dynamodb_table.rewards.name
    app_data  = aws_dynamodb_table.app_data.name
  }
}

output "cache_bucket" {
  value = aws_s3_bucket.cache.bucket
}
