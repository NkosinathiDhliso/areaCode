# EMERGENCY COST REDUCTION - DESTROY EXPENSIVE RESOURCES
# This file removes the highest-cost AWS resources to save credits
# Run: terraform apply -target=module.ecs_api -target=module.rds -target=module.elasticache -target=module.waf

# =============================================================================
# OPTION 1: IMMEDIATE SCALE DOWN (Fastest - stops costs within minutes)
# =============================================================================

# Scale ECS to 0 tasks (stops compute charges immediately)
# ECS will still exist but cost ~$0 when no tasks running
resource "null_resource" "scale_ecs_to_zero" {
  triggers = {
    always_run = timestamp()
  }

  provisioner "local-exec" {
    command = <<-EOT
      aws ecs update-service \
        --cluster area-code-prod \
        --service area-code-prod-api \
        --desired-count 0 \
        --region us-east-1 || echo "ECS service not found or already scaled down"
    EOT
  }
}

# =============================================================================
# OPTION 2: TERRAFORM DESTROY (Permanent removal - use with caution)
# =============================================================================

# To DESTROY resources permanently (after backing up data):
# terraform destroy -target=module.ecs_api -target=module.rds -target=module.elasticache -target=module.waf

# OR comment out these modules in ../environments/prod/main.tf:
# - module "ecs_api" (lines 457-494)
# - module "rds" (lines 138-147)  
# - module "elasticache" (lines 149-157)
# - module "waf" (lines 496-501)

# =============================================================================
# COST SAVINGS BREAKDOWN (Estimated Monthly)
# =============================================================================
# Resource                    | Est. Monthly Cost | Action
# ----------------------------|-------------------|------------------------
# ECS Fargate (2 tasks)       | $50-70            | Scale to 0 or destroy
# RDS (db.t4g.medium multiAZ) | $60-80            | Destroy (backup first!)
# ElastiCache (2x t4g.small)  | $40-60            | Destroy
# ALB                         | $20-25            | Destroy with ECS
# NAT Gateway (x2)            | $60-80            | May be in VPC module
# WAF                         | $20-30            | Destroy
# ----------------------------|-------------------|------------------------
# TOTAL POTENTIAL SAVINGS     | $250-345/month    |
# =============================================================================
