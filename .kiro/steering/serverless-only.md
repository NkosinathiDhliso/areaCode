<!-- GENERATED FILE. DO NOT EDIT.
     Single source of truth: rules/*.md
     Regenerate with: pnpm sync:rules -->

---
inclusion: always
---

# Serverless-Only Architecture Rule

This project is **strictly serverless**. We do not have the budget for always-on resources.

## Forbidden Resources

Never create, suggest, or reference any of the following AWS resources in any environment (dev or prod):

- **ECS / Fargate** — no containers, no tasks, no services, no clusters
- **ALB / NLB / ELB** — no load balancers of any kind
- **RDS** — no relational database instances (use DynamoDB)
- **ElastiCache / Redis** — no managed cache clusters (use DynamoDB TTL-based KV)
- **NAT Gateway** — never enable; use VPC endpoints if Lambda needs AWS service access
- **EC2 instances** — no virtual machines
- **EKS** — no Kubernetes
- **WAF attached to ALB** — WAF is only acceptable on API Gateway or CloudFront

## Allowed Resources (pay-per-use / scales to zero)

- **Lambda** — all compute runs here
- **API Gateway (HTTP API)** — all HTTP traffic routes through here
- **DynamoDB** (PAY_PER_REQUEST) — primary database
- **S3** — media and static assets
- **SQS** — async message queues
- **Cognito** — authentication
- **EventBridge** — scheduled tasks
- **CloudWatch Logs** — observability
- **Amplify Hosting** — frontend deployments
- **Pinpoint SMS Voice v2** — OTP SMS delivery
- **SES** — transactional email (admin notifications, receipts)
- **Secrets Manager** — secret storage (but avoid VPC Interface Endpoints to access it; use Lambda environment variables or parameter store instead where possible)

## Infrastructure Rules

1. The `infra/environments/dev/main.tf` and `infra/environments/prod/main.tf` files must never contain ECS, RDS, ElastiCache, ALB, or NAT Gateway modules.
2. The VPC module must always have `enable_nat_gateway = false`.
3. Budget alerts should be set to $50 for dev and $100 for prod.
4. All DynamoDB tables must use `billing_mode = "PAY_PER_REQUEST"`.
5. All Lambda functions should use `arm64` architecture for cost efficiency.
6. Never add VPC Interface Endpoints ($7.50/mo each) unless absolutely required and explicitly approved.

## Why

We are a bootstrapped South African startup. Every dollar of AWS spend matters. Serverless lets us scale to zero when idle and only pay for actual usage. At our current scale (pre-launch / early users), the serverless approach keeps monthly costs under $20-30 instead of $100-200+.
