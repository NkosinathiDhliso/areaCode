variable "env" {
  type = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "azs" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b"]
}

variable "enable_nat_gateway" {
  type    = bool
  default = true
}

locals {
  public_subnets  = [for i, az in var.azs : cidrsubnet(var.vpc_cidr, 8, i)]
  private_subnets = [for i, az in var.azs : cidrsubnet(var.vpc_cidr, 8, i + 10)]
  db_subnets      = [for i, az in var.azs : cidrsubnet(var.vpc_cidr, 8, i + 20)]
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "area-code-${var.env}" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "area-code-${var.env}-igw" }
}

# --- Public subnets ---
resource "aws_subnet" "public" {
  count                   = length(var.azs)
  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_subnets[count.index]
  availability_zone       = var.azs[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "area-code-${var.env}-public-${var.azs[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "area-code-${var.env}-public-rt" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# --- NAT Gateway (optional — skip in dev to save ~$32/mo) ---
resource "aws_eip" "nat" {
  count  = var.enable_nat_gateway ? 1 : 0
  domain = "vpc"
  tags   = { Name = "area-code-${var.env}-nat-eip" }
}

resource "aws_nat_gateway" "this" {
  count         = var.enable_nat_gateway ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "area-code-${var.env}-nat" }

  depends_on = [aws_internet_gateway.this]
}

# --- Private subnets ---
resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_subnets[count.index]
  availability_zone = var.azs[count.index]
  tags              = { Name = "area-code-${var.env}-private-${var.azs[count.index]}" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "area-code-${var.env}-private-rt" }
}

resource "aws_route" "private_nat" {
  count                  = var.enable_nat_gateway ? 1 : 0
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[0].id
}

resource "aws_route_table_association" "private" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# --- Database subnets ---
resource "aws_subnet" "db" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.db_subnets[count.index]
  availability_zone = var.azs[count.index]
  tags              = { Name = "area-code-${var.env}-db-${var.azs[count.index]}" }
}

resource "aws_db_subnet_group" "this" {
  name       = "area-code-${var.env}"
  subnet_ids = aws_subnet.db[*].id
  tags       = { Name = "area-code-${var.env}-db-subnet-group" }
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "area-code-${var.env}"
  subnet_ids = aws_subnet.private[*].id
}

# --- Security Groups ---
resource "aws_security_group" "lambda" {
  name_prefix = "area-code-${var.env}-lambda-"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "Allow HTTPS from VPC for VPC endpoints"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    self        = true
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "area-code-${var.env}-lambda-sg" }
}

resource "aws_security_group" "ecs" {
  name_prefix = "area-code-${var.env}-ecs-"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port   = 4000
    to_port     = 4000
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "area-code-${var.env}-ecs-sg" }
}

resource "aws_security_group" "alb" {
  name_prefix = "area-code-${var.env}-alb-"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "area-code-${var.env}-alb-sg" }
}

resource "aws_security_group" "db" {
  name_prefix = "area-code-${var.env}-db-"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id, aws_security_group.ecs.id]
  }

  tags = { Name = "area-code-${var.env}-db-sg" }
}

resource "aws_security_group" "redis" {
  name_prefix = "area-code-${var.env}-redis-"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id, aws_security_group.ecs.id]
  }

  tags = { Name = "area-code-${var.env}-redis-sg" }
}

# --- Outputs ---
output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "db_subnet_group_name" {
  value = aws_db_subnet_group.this.name
}

output "elasticache_subnet_group_name" {
  value = aws_elasticache_subnet_group.this.name
}

output "lambda_security_group_ids" {
  value = [aws_security_group.lambda.id]
}

output "ecs_security_group_ids" {
  value = [aws_security_group.ecs.id, aws_security_group.alb.id]
}

output "db_security_group_ids" {
  value = [aws_security_group.db.id]
}

output "redis_security_group_ids" {
  value = [aws_security_group.redis.id]
}
