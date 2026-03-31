variable "env" {
  type = string
}

variable "service_name" {
  type = string
}

variable "container_port" {
  type    = number
  default = 4000
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 2
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "secrets" {
  type    = map(string)
  default = {}
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}

variable "custom_domain" {
  description = "Custom domain for the ALB (e.g. api.areacode.co.za). Creates ACM cert. Leave empty to skip."
  type        = string
  default     = ""
}

variable "enable_https" {
  description = "Set to true AFTER the ACM certificate has been DNS-validated on your domain registrar."
  type        = bool
  default     = false
}

variable "public_subnet_ids" {
  description = "Public subnets for the internet-facing ALB. Falls back to subnet_ids if not set."
  type        = list(string)
  default     = []
}

resource "aws_ecr_repository" "this" {
  name                 = "area-code-${var.env}-${var.service_name}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecs_cluster" "this" {
  name = "area-code-${var.env}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_iam_role" "task_execution" {
  name = "area-code-${var.env}-${var.service_name}-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "secrets_access" {
  name = "secrets-access"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = "arn:aws:secretsmanager:us-east-1:*:secret:area-code/${var.env}/*"
    }]
  })
}

resource "aws_iam_role" "task" {
  name = "area-code-${var.env}-${var.service_name}-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_ecs_task_definition" "this" {
  family                   = "area-code-${var.env}-${var.service_name}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = var.service_name
    image     = "${aws_ecr_repository.this.repository_url}:latest"
    essential = true

    portMappings = [{
      containerPort = var.container_port
      protocol      = "tcp"
    }]

    environment = [for k, v in var.environment_variables : { name = k, value = v }]
    secrets     = [for k, v in var.secrets : { name = k, valueFrom = v }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/area-code-${var.env}-${var.service_name}"
        "awslogs-region"        = "us-east-1"
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/area-code-${var.env}-${var.service_name}"
  retention_in_days = 30
}

locals {
  alb_subnets       = length(var.public_subnet_ids) > 0 ? var.public_subnet_ids : var.subnet_ids
  has_custom_domain = var.custom_domain != ""
}

resource "aws_lb" "this" {
  name               = "area-code-${var.env}-${var.service_name}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = var.security_group_ids
  subnets            = local.alb_subnets
}

resource "aws_lb_target_group" "this" {
  name        = "ac-${var.env}-${var.service_name}-${var.container_port}"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
  }

  lifecycle {
    create_before_destroy = true
  }
}

# --- ACM certificate (created when custom_domain is set, validated externally) ---
resource "aws_acm_certificate" "this" {
  count             = local.has_custom_domain ? 1 : 0
  domain_name       = var.custom_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "area-code-${var.env}-${var.service_name}" }
}

# --- HTTPS listener (only when enable_https = true, i.e. cert is validated) ---
resource "aws_lb_listener" "https" {
  count             = var.enable_https ? 1 : 0
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.this[0].arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

# --- HTTP listener: always forward to target group.
#     When HTTPS is enabled, redirect instead. ---
resource "aws_lb_listener" "http_forward" {
  count             = var.enable_https ? 0 : 1
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count             = var.enable_https ? 1 : 0
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_ecs_service" "this" {
  name            = "area-code-${var.env}-${var.service_name}"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.subnet_ids
    security_groups = var.security_group_ids
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this.arn
    container_name   = var.service_name
    container_port   = var.container_port
  }

  depends_on = [
    aws_lb_listener.http_forward,
    aws_lb_listener.https,
  ]
}

output "ecr_repository_url" {
  value = aws_ecr_repository.this.repository_url
}

output "service_name" {
  value = aws_ecs_service.this.name
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_arn" {
  value = aws_lb.this.arn
}

output "task_role_name" {
  value = aws_iam_role.task.name
}

output "acm_certificate_arn" {
  value = local.has_custom_domain ? aws_acm_certificate.this[0].arn : ""
}

output "acm_validation_records" {
  description = "DNS records to add for ACM certificate validation"
  value = local.has_custom_domain ? {
    for dvo in aws_acm_certificate.this[0].domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  } : {}
}
