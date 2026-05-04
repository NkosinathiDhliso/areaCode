# One-time setup of GitHub Actions OIDC -> AWS IAM trust for Lambda deploys.
# After running this, add the printed role ARN to GitHub repo secret AWS_DEPLOY_ROLE_ARN.
# Re-runnable: skips resources that already exist.

param(
    [string]$Repo = "NkosinathiDhliso/areaCode",
    [string]$RoleName = "github-actions-lambda-deploy",
    [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Stop"
$env:AWS_PAGER = ""

$AccountId = aws sts get-caller-identity --query Account --output text
Write-Host "Account: $AccountId  Repo: $Repo" -ForegroundColor Cyan

# --- 1. Create OIDC provider (idempotent) ---
$existing = aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[?contains(Arn,'token.actions.githubusercontent.com')].Arn" --output text
if ([string]::IsNullOrWhiteSpace($existing)) {
    Write-Host "[1/3] Creating OIDC provider..." -ForegroundColor Yellow
    aws iam create-open-id-connect-provider `
        --url "https://token.actions.githubusercontent.com" `
        --client-id-list "sts.amazonaws.com" `
        --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" | Out-Null
    Write-Host "  OK  OIDC provider created" -ForegroundColor Green
} else {
    Write-Host "[1/3] OIDC provider already exists: $existing" -ForegroundColor DarkGray
}

# --- 2. Create role with trust policy ---
$trustPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::${AccountId}:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike":   { "token.actions.githubusercontent.com:sub": "repo:${Repo}:*" }
    }
  }]
}
"@
$trustFile = Join-Path $env:TEMP "gh-oidc-trust.json"
$trustPolicy | Out-File -FilePath $trustFile -Encoding ascii -NoNewline

$roleArn = aws iam get-role --role-name $RoleName --query "Role.Arn" --output text 2>$null
if ([string]::IsNullOrWhiteSpace($roleArn) -or $roleArn -like "*error*") {
    Write-Host "[2/3] Creating role $RoleName..." -ForegroundColor Yellow
    $roleArn = aws iam create-role `
        --role-name $RoleName `
        --assume-role-policy-document "file://$trustFile" `
        --description "GitHub Actions OIDC role for Lambda code deploys" `
        --query "Role.Arn" --output text
    Write-Host "  OK  Role created: $roleArn" -ForegroundColor Green
} else {
    Write-Host "[2/3] Role exists. Refreshing trust policy..." -ForegroundColor DarkGray
    aws iam update-assume-role-policy --role-name $RoleName --policy-document "file://$trustFile" | Out-Null
}

# --- 3. Attach inline policy with Lambda deploy perms ---
$permPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:PublishVersion",
      "lambda:ListVersionsByFunction"
    ],
    "Resource": "arn:aws:lambda:${Region}:${AccountId}:function:area-code-*"
  }]
}
"@
$permFile = Join-Path $env:TEMP "gh-oidc-perm.json"
$permPolicy | Out-File -FilePath $permFile -Encoding ascii -NoNewline

Write-Host "[3/3] Attaching deploy permissions..." -ForegroundColor Yellow
aws iam put-role-policy `
    --role-name $RoleName `
    --policy-name "lambda-deploy" `
    --policy-document "file://$permFile" | Out-Null
Write-Host "  OK  Inline policy attached" -ForegroundColor Green

Write-Host ""
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " Done. Now add this to GitHub repo secrets:" -ForegroundColor Cyan
Write-Host ""
Write-Host "   Name:  AWS_DEPLOY_ROLE_ARN" -ForegroundColor White
Write-Host "   Value: $roleArn" -ForegroundColor White
Write-Host ""
Write-Host " UI: https://github.com/$Repo/settings/secrets/actions" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
