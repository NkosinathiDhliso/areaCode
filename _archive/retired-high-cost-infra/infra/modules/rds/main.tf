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
