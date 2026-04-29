EMERGENCY AWS COST REDUCTION - IMMEDIATE ACTION REQUIRED
=======================================================

Your current AWS bill: ~$278/month (credits running out!)
Target serverless cost: ~$10-30/month (95% reduction)

IMMEDIATE ACTIONS (Do these NOW to stop the bleeding):
------------------------------------------------------

1. SCALE ECS TO ZERO (Stops ~$50-70/month within minutes)
   Run these AWS CLI commands:

   aws ecs update-service --cluster area-code-prod --service area-code-prod-api --desired-count 0 --region us-east-1

2. DELETE COSTLY RESOURCES (Saves ~$200+/month)
   
   A) Backup your data first:
      - RDS: Create final snapshot (terraform will do this)
      - ElastiCache: Export Redis data if needed
   
   B) Comment out these modules in infra/environments/prod/main.tf:
      - module "ecs_api" (lines 457-494)
      - module "rds" (lines 138-147)
      - module "elasticache" (lines 149-157)
      - module "waf" (lines 496-501)
   
   C) Apply the changes:
      cd infra/environments/prod
      terraform apply

WHAT TO KEEP (Minimal viable infrastructure):
---------------------------------------------

KEEP THESE (Low cost, essential):
- Cognito User Pools (~$0 unless MAU > 10,000)
- Lambda functions (~$0-5 for low traffic)
- S3 buckets (~$0-5 for small storage)
- API Gateway HTTP API (~$3/million requests)
- DynamoDB on-demand (~$0 if no tables yet)
- Secrets Manager (~$0.40/secret)

DELETE THESE (High fixed costs):
- ECS/Fargate (always running = always charging)
- RDS PostgreSQL (hourly charge even when idle)
- ElastiCache Redis (hourly charge per node)
- Application Load Balancer (~$20/month base)
- NAT Gateway (~$30-50/month per gateway)
- WAF (~$5/month base + rules)

SERVERLESS MIGRATION PATH:
--------------------------

The serverless-migration.tf file creates:
1. DynamoDB tables (pay-per-request, scales to zero)
2. Lambda Function URLs (no ALB needed)
3. S3 for simple caching (replace ElastiCache)

Cost comparison:
- RDS db.t4g.medium multi-AZ: ~$70/month always
- DynamoDB on-demand: ~$0-10/month (scales with usage)

- ElastiCache 2x t4g.small: ~$50/month always
- S3 cache: ~$0-5/month (depends on size)

- ECS Fargate 2 tasks: ~$60/month always
- Lambda: ~$0-5/month (pay per invocation)

DATA MIGRATION:
---------------

PostgreSQL -> DynamoDB:
1. Export RDS data: pg_dump or AWS DMS
2. Transform relational data to DynamoDB item format
3. Import using BatchWriteItem

Redis -> S3/CloudFront:
1. For session/cache data: Move to DynamoDB TTL
2. For static assets: Already in S3

WARNING:
--------
- RDS has deletion_protection = true in prod
- You must disable this before terraform destroy:
  
  aws rds modify-db-instance \
    --db-instance-identifier area-code-prod-primary \
    --no-deletion-protection \
    --region us-east-1

SUPPORTING DOCUMENTATION:
-------------------------

Original files:
- ECS service: infra/modules/ecs-service/main.tf
- RDS: infra/modules/rds/main.tf
- ElastiCache: infra/modules/elasticache/main.tf

Migration files:
- destroy-costly-resources.tf - Scripts to remove expensive resources
- serverless-migration.tf - Serverless replacement resources

ESTIMATED TIMELINE:
-------------------

Immediate (5 minutes): Scale ECS to 0
Short term (1 hour): Destroy RDS, ElastiCache, ALB
Medium term (1-2 days): Migrate data to DynamoDB
Long term (1 week): Full serverless re-architecture

CONTACT:
--------
If you need help, these are the specific resource IDs in your account:
- ECS Cluster: area-code-prod
- ECS Service: area-code-prod-api
- RDS Instance: area-code-prod-primary
- ElastiCache: area-code-prod
- ALB: area-code-prod-api (via ecs_api module)
