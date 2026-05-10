variable "env" {
  type = string
}

variable "instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "vpc_security_group_ids" {
  type = list(string)
}

variable "subnet_group_name" {
  type = string
}

variable "create_read_replica" {
  type    = bool
  default = false
}

resource "aws_db_instance" "primary" {
  identifier     = "area-code-${var.env}-primary"
  engine         = "postgres"
  engine_version = "16.4"
  instance_class = var.instance_class

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_encrypted     = true

  db_name  = "areacode"
  username = "areacode_admin"

  manage_master_user_password = true

  multi_az               = var.multi_az
  db_subnet_group_name   = var.subnet_group_name
  vpc_security_group_ids = var.vpc_security_group_ids

  backup_retention_period   = 7
  backup_window             = "02:00-03:00"
  maintenance_window        = "sun:04:00-sun:05:00"
  deletion_protection       = var.env == "prod"
  skip_final_snapshot       = var.env != "prod"
  final_snapshot_identifier = var.env == "prod" ? "area-code-${var.env}-final" : null

  performance_insights_enabled = true

  tags = {
    Environment = var.env
  }
}

resource "aws_db_instance" "read_replica" {
  count = var.create_read_replica ? 1 : 0

  identifier          = "area-code-${var.env}-read"
  replicate_source_db = aws_db_instance.primary.identifier
  instance_class      = var.instance_class
  storage_encrypted   = true

  vpc_security_group_ids = var.vpc_security_group_ids

  performance_insights_enabled = true

  tags = {
    Environment = var.env
    Role        = "read-replica"
  }
}

output "primary_endpoint" {
  value = aws_db_instance.primary.endpoint
}

output "read_endpoint" {
  value = var.create_read_replica ? aws_db_instance.read_replica[0].endpoint : aws_db_instance.primary.endpoint
}

output "primary_arn" {
  value = aws_db_instance.primary.arn
}

# ─── RDS Proxy ────────────────────────────────────────────────────────────────
# Multiplexes Lambda → RDS connections. Without this, ~50 concurrent Lambdas
# will exhaust Postgres' max_connections. The proxy is required for any serious
# Lambda-fronted Postgres workload.

variable "enable_rds_proxy" {
  type    = bool
  default = true
}

variable "subnet_ids" {
  type    = list(string)
  default = []
  description = "Private subnet IDs for the RDS Proxy (must be in same VPC as RDS)."
}

resource "aws_iam_role" "rds_proxy" {
  count = var.enable_rds_proxy ? 1 : 0
  name  = "area-code-${var.env}-rds-proxy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "rds.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "rds_proxy_secrets" {
  count = var.enable_rds_proxy ? 1 : 0
  role  = aws_iam_role.rds_proxy[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret",
      ]
      # Auto-generated master user password secret managed by RDS itself.
      Resource = aws_db_instance.primary.master_user_secret[0].secret_arn
    }]
  })
}

resource "aws_db_proxy" "main" {
  count                  = var.enable_rds_proxy ? 1 : 0
  name                   = "area-code-${var.env}-proxy"
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.rds_proxy[0].arn
  vpc_subnet_ids         = var.subnet_ids
  vpc_security_group_ids = var.vpc_security_group_ids
  require_tls            = true
  idle_client_timeout    = 1800
  debug_logging          = false

  auth {
    auth_scheme = "SECRETS"
    iam_auth    = "DISABLED"
    secret_arn  = aws_db_instance.primary.master_user_secret[0].secret_arn
  }

  tags = { Environment = var.env }
}

resource "aws_db_proxy_default_target_group" "main" {
  count         = var.enable_rds_proxy ? 1 : 0
  db_proxy_name = aws_db_proxy.main[0].name

  connection_pool_config {
    # Each Lambda connection multiplexes onto fewer real DB connections.
    # Tune based on instance size: t4g.medium has ~80 max_connections.
    max_connections_percent      = 75
    max_idle_connections_percent = 25
    connection_borrow_timeout    = 120
    # Pin transactions and prepared statements (Prisma uses both heavily).
    session_pinning_filters      = []
  }
}

resource "aws_db_proxy_target" "main" {
  count                  = var.enable_rds_proxy ? 1 : 0
  db_instance_identifier = aws_db_instance.primary.id
  db_proxy_name          = aws_db_proxy.main[0].name
  target_group_name      = aws_db_proxy_default_target_group.main[0].name
}

output "proxy_endpoint" {
  value = var.enable_rds_proxy ? aws_db_proxy.main[0].endpoint : aws_db_instance.primary.endpoint
  description = "Use this in Lambda DATABASE_URL — never the raw RDS endpoint."
}

output "proxy_arn" {
  value = var.enable_rds_proxy ? aws_db_proxy.main[0].arn : null
}
