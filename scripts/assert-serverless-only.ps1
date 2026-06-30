$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Forbidden = @(
  @{ Pattern = "@prisma/client"; Reason = "Prisma/Postgres is not part of production serverless runtime" },
  @{ Pattern = "shared/db/prisma"; Reason = "Prisma/Postgres is not part of production serverless runtime" },
  @{ Pattern = "AREA_CODE_DB_URL"; Reason = "Production API must not require RDS/Postgres" },
  @{ Pattern = "aws_db_instance"; Reason = "RDS is retired from production infrastructure" },
  @{ Pattern = "aws_rds_cluster"; Reason = "RDS/Aurora is retired from production infrastructure" },
  @{ Pattern = "aws_elasticache"; Reason = "ElastiCache/Redis is retired from production infrastructure" },
  @{ Pattern = "aws_ecs_service"; Reason = "ECS/Fargate is retired from production infrastructure" },
  @{ Pattern = "aws_lb"; Reason = "ALB is retired from production API infrastructure" },
  @{ Pattern = 'module "rds"'; Reason = "RDS module must not be active" },
  @{ Pattern = 'module "ecs_api"'; Reason = "ECS API module must not be active" },
  @{ Pattern = 'module "elasticache"'; Reason = "ElastiCache module must not be active" }
)

$SearchRoots = @(
  "backend/src",
  "infra/environments",
  "infra/modules",
  "deploy-api.ps1",
  "scripts"
)

$ExcludePathPatterns = @(
  "node_modules",
  "dist",
  ".terraform",
  "assert-serverless-only.ps1"
)

$Failures = @()

foreach ($rootRelative in $SearchRoots) {
  $rootPath = Join-Path $Root $rootRelative
  if (-not (Test-Path $rootPath)) { continue }

  $files = if (Test-Path $rootPath -PathType Leaf) {
    @(Get-Item $rootPath)
  } else {
    Get-ChildItem $rootPath -Recurse -File -Include *.ts,*.tsx,*.js,*.mjs,*.cjs,*.tf,*.ps1,*.json
  }

  foreach ($file in $files) {
    $relative = Resolve-Path -Path $file.FullName -Relative
    $skip = $false
    foreach ($exclude in $ExcludePathPatterns) {
      if ($relative -like "*$exclude*") {
        $skip = $true
        break
      }
    }
    if ($skip) { continue }

    $content = Get-Content $file.FullName -Raw
    foreach ($rule in $Forbidden) {
      if ($content -match [regex]::Escape($rule.Pattern)) {
        $Failures += [pscustomobject]@{
          File = $relative
          Pattern = $rule.Pattern
          Reason = $rule.Reason
        }
      }
    }
  }
}

if ($Failures.Count -gt 0) {
  Write-Host "Serverless-only guard failed. Forbidden production architecture references found:" -ForegroundColor Red
  $Failures | Format-Table -AutoSize
  exit 1
}

Write-Host "Serverless-only guard passed." -ForegroundColor Green
