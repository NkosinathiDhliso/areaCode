# Quick deploy: build + zip + push the monolith API Lambda.
# Usage:  ./deploy-api.ps1            # deploys to prod
#         ./deploy-api.ps1 -Env dev   # deploys to dev
#         ./deploy-api.ps1 -SkipBuild # skip rebuild, just re-upload existing zip

param(
    [string]$Env = "prod",
    [string]$Region = "us-east-1",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$env:AWS_PAGER = ""

$Root     = $PSScriptRoot
$DistDir  = Join-Path $Root "backend\dist\lambda"
$Zip      = Join-Path $Root "backend\dist\api-lambda.zip"
$FnName   = "area-code-$Env-api"

if (-not $SkipBuild) {
    Write-Host "[1/3] Building Lambda bundle..." -ForegroundColor Yellow
    pnpm --filter backend build:lambda
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
}

if (-not (Test-Path (Join-Path $DistDir "index.mjs"))) {
    throw "Bundle not found at $DistDir\index.mjs. Run without -SkipBuild."
}

Write-Host "[2/3] Zipping bundle..." -ForegroundColor Yellow
Compress-Archive -Path (Join-Path $DistDir "index.mjs") -DestinationPath $Zip -Force

Write-Host "[3/3] Deploying $FnName..." -ForegroundColor Yellow
$result = aws lambda update-function-code `
    --function-name $FnName `
    --zip-file "fileb://$Zip" `
    --region $Region `
    --publish `
    --query "{Version:Version,LastModified:LastModified,CodeSize:CodeSize}" `
    --output json
if ($LASTEXITCODE -ne 0) { throw "Lambda deploy failed" }

Write-Host ""
Write-Host "OK  $FnName updated:" -ForegroundColor Green
Write-Host $result
