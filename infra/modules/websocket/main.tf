# API Gateway WebSocket API for Real-Time Features
# Replaces Socket.io server with serverless architecture

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "env" {
  type = string
}

variable "lambda_function_arn" {
  type = string
}

variable "lambda_function_name" {
  type = string
}

variable "lambda_invoke_arn" {
  type = string
}

variable "lambda_role_name" {
  type        = string
  description = "IAM role name for the WebSocket Lambda (for attaching policies)"
}

# WebSocket API
resource "aws_apigatewayv2_api" "websocket" {
  name                       = "area-code-${var.env}-websocket"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

# Connection management DynamoDB table
resource "aws_dynamodb_table" "websocket_connections" {
  name         = "area-code-${var.env}-websocket-connections"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "connectionId"

  attribute {
    name = "connectionId"
    type = "S"
  }

  attribute {
    name = "roomId"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name            = "RoomIndex"
    hash_key        = "roomId"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "UserIndex"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

# Lambda integration
resource "aws_apigatewayv2_integration" "websocket" {
  api_id           = aws_apigatewayv2_api.websocket.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.lambda_invoke_arn
}

# Routes
resource "aws_apigatewayv2_route" "connect" {
  api_id    = aws_apigatewayv2_api.websocket.id
  route_key = "$connect"
  target    = "integrations/${aws_apigatewayv2_integration.websocket.id}"
}

resource "aws_apigatewayv2_route" "disconnect" {
  api_id    = aws_apigatewayv2_api.websocket.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.websocket.id}"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.websocket.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.websocket.id}"
}

# Custom routes for app events
resource "aws_apigatewayv2_route" "join_room" {
  api_id    = aws_apigatewayv2_api.websocket.id
  route_key = "joinroom"
  target    = "integrations/${aws_apigatewayv2_integration.websocket.id}"
}

resource "aws_apigatewayv2_route" "leave_room" {
  api_id    = aws_apigatewayv2_api.websocket.id
  route_key = "leaveroom"
  target    = "integrations/${aws_apigatewayv2_integration.websocket.id}"
}

# Deployment
resource "aws_apigatewayv2_deployment" "websocket" {
  api_id = aws_apigatewayv2_api.websocket.id

  depends_on = [
    aws_apigatewayv2_route.connect,
    aws_apigatewayv2_route.disconnect,
    aws_apigatewayv2_route.default,
    aws_apigatewayv2_route.join_room,
    aws_apigatewayv2_route.leave_room,
  ]

  lifecycle {
    create_before_destroy = true
  }
}

# Stage
resource "aws_apigatewayv2_stage" "websocket" {
  api_id        = aws_apigatewayv2_api.websocket.id
  name          = var.env
  deployment_id = aws_apigatewayv2_deployment.websocket.id
  auto_deploy   = false
}

# Lambda permission
resource "aws_lambda_permission" "websocket" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.websocket.execution_arn}/*/*"
}

# IAM role for Lambda to manage connections
resource "aws_iam_role_policy" "websocket_connections" {
  name = "websocket-connections-${var.env}"
  role = var.lambda_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "execute-api:ManageConnections",
          "execute-api:Invoke"
        ]
        Resource = "${aws_apigatewayv2_api.websocket.execution_arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          aws_dynamodb_table.websocket_connections.arn,
          "${aws_dynamodb_table.websocket_connections.arn}/index/*"
        ]
      }
    ]
  })
}

# Outputs
output "websocket_api_endpoint" {
  value = "${aws_apigatewayv2_api.websocket.api_endpoint}/${var.env}"
}

output "websocket_api_id" {
  value = aws_apigatewayv2_api.websocket.id
}

output "connections_table_name" {
  value = aws_dynamodb_table.websocket_connections.name
}

output "connections_table_arn" {
  value = aws_dynamodb_table.websocket_connections.arn
}
