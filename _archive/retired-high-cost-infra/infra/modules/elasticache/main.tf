variable "env" {
  type = string
}

variable "node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "num_cache_clusters" {
  type    = number
  default = 3
}

variable "subnet_group_name" {
  type = string
}

variable "security_group_ids" {
  type = list(string)
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "area-code-${var.env}"
  description          = "Area Code ${var.env} Redis cluster"

  node_type            = var.node_type
  num_cache_clusters   = var.num_cache_clusters
  engine               = "redis"
  engine_version       = "7.1"
  port                 = 6379
  parameter_group_name = "default.redis7"

  automatic_failover_enabled = var.num_cache_clusters > 1
  multi_az_enabled           = var.num_cache_clusters > 1

  subnet_group_name  = var.subnet_group_name
  security_group_ids = var.security_group_ids

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  tags = {
    Environment = var.env
  }
}

output "primary_endpoint" {
  value = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "reader_endpoint" {
  value = aws_elasticache_replication_group.this.reader_endpoint_address
}
