#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Update all 4 Area Code Amplify apps with new serverless API endpoints
.DESCRIPTION
    Updates environment variables and triggers redeployment for all frontend apps
#>

param(
    [string]$Region = "us-east-1",
    # REST API is served on the stable custom domain. The WebSocket API has no
    # custom domain, so it stays on its execute-api endpoint (a distinct API id
    # from the HTTP API - do not reuse the HTTP id here or real-time breaks).
    [string]$ApiUrl = "https://api.areacode.co.za",
    [string]$WebSocketUrl = "wss://ilcimxarf0.execute-api.us-east-1.amazonaws.com/prod",
    [string]$MapboxToken = $env:VITE_MAPBOX_TOKEN,
    # CloudWatch RUM monitor + identity pool IDs per app.
    # Pull these from `terraform output -json rum_monitors` after applying.
    [string]$RumWebMonitorId = $env:RUM_WEB_MONITOR_ID,
    [string]$RumWebIdentityPool = $env:RUM_WEB_IDENTITY_POOL,
    [string]$RumBusinessMonitorId = $env:RUM_BUSINESS_MONITOR_ID,
    [string]$RumBusinessIdentityPool = $env:RUM_BUSINESS_IDENTITY_POOL,
    [string]$RumStaffMonitorId = $env:RUM_STAFF_MONITOR_ID,
    [string]$RumStaffIdentityPool = $env:RUM_STAFF_IDENTITY_POOL,
    [string]$RumAdminMonitorId = $env:RUM_ADMIN_MONITOR_ID,
    [string]$RumAdminIdentityPool = $env:RUM_ADMIN_IDENTITY_POOL
)

$ErrorActionPreference = "Stop"

# Color output functions
function Write-Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host $msg -ForegroundColor Green }
function Write-Err($msg) { Write-Host $msg -ForegroundColor Red }
function Write-Warn($msg) { Write-Host $msg -ForegroundColor Yellow }

# Your 4 Amplify Apps
$AmplifyApps = @(
    @{
        Name = "Web (Main)"; AppId = "d3pm78r41ma6w6"; Branch = "master"; Domain = "areacode.co.za"
        RumMonitorId = $RumWebMonitorId; RumIdentityPool = $RumWebIdentityPool
    },
    @{
        Name = "Admin"; AppId = "d1ay6jict0ql9w"; Branch = "master"; Domain = "admin.areacode.co.za"
        RumMonitorId = $RumAdminMonitorId; RumIdentityPool = $RumAdminIdentityPool
    },
    @{
        Name = "Business"; AppId = "dbp54yxhyjvk0"; Branch = "master"; Domain = "business.areacode.co.za"
        RumMonitorId = $RumBusinessMonitorId; RumIdentityPool = $RumBusinessIdentityPool
    },
    @{
        Name = "Staff"; AppId = "d166bb81tg4k61"; Branch = "master"; Domain = "staff.areacode.co.za"
        RumMonitorId = $RumStaffMonitorId; RumIdentityPool = $RumStaffIdentityPool
    }
)

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Updating All Area Code Amplify Apps" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Info "API Endpoint: $ApiUrl"
if ($MapboxToken) {
    Write-Info "Mapbox Token: $($MapboxToken.Substring(0, [Math]::Min(10, $MapboxToken.Length)))..."
} else {
    Write-Warn "Mapbox Token: NOT SET (pass -MapboxToken or set VITE_MAPBOX_TOKEN env var)"
}
Write-Info "Region: $Region"
Write-Host ""

$successCount = 0
$failCount = 0

foreach ($app in $AmplifyApps) {
    Write-Host "----------------------------------------"
    Write-Info "Updating: $($app.Name)"
    Write-Info "  App ID: $($app.AppId)"
    Write-Info "  Branch: $($app.Branch)"
    Write-Info "  Domain: $($app.Domain)"

    # Update environment variables
    Write-Host "  Setting environment variables..." -ForegroundColor Gray

    # Build the MANAGED environment variables this script owns - Web (basemap)
    # and Business (address autocomplete via Mapbox Geocoding) both need the
    # Mapbox token.
    $managed = [ordered]@{
        VITE_API_URL       = $ApiUrl
        VITE_SOCKET_URL    = $ApiUrl
        VITE_WEBSOCKET_URL = $WebSocketUrl
    }
    if (($app.Name -eq "Web (Main)" -or $app.Name -eq "Business") -and $MapboxToken) {
        $managed['VITE_MAPBOX_TOKEN'] = $MapboxToken
    }
    # The Business dashboard generates staff invite links pointing at the staff
    # portal. Give it the staff origin explicitly so the link never depends on a
    # `business.`->`staff.` hostname swap.
    if ($app.Name -eq "Business") {
        $managed['VITE_STAFF_URL'] = "https://staff.areacode.co.za"
    }
    if ($app.RumMonitorId -and $app.RumIdentityPool) {
        $managed['VITE_RUM_APP_MONITOR_ID'] = $app.RumMonitorId
        $managed['VITE_RUM_IDENTITY_POOL_ID'] = $app.RumIdentityPool
        $managed['VITE_RUM_REGION'] = $Region
    } else {
        Write-Warn "  [warn] RUM env vars not provided for $($app.Name) - frontend monitoring will be disabled"
    }

    # MERGE, never replace. update-branch --environment-variables overwrites the
    # ENTIRE env set, so we must fetch the existing vars and overlay only the
    # keys we own. Otherwise out-of-band vars (Cognito Hosted-UI OAuth domains +
    # client IDs, VAPID keys) would be silently wiped, breaking Google sign-in
    # and web push on the next run.
    $existingJson = aws amplify get-branch `
        --app-id $app.AppId `
        --branch-name $app.Branch `
        --region $Region `
        --query "branch.environmentVariables" --output json 2>$null
    $merged = [ordered]@{}
    if ($LASTEXITCODE -eq 0 -and $existingJson) {
        $existing = $existingJson | ConvertFrom-Json
        foreach ($p in $existing.PSObject.Properties) { $merged[$p.Name] = $p.Value }
    } else {
        Write-Warn "  [warn] Could not read existing env vars; proceeding with managed keys only"
    }
    foreach ($k in $managed.Keys) { $merged[$k] = $managed[$k] }

    $payload = [ordered]@{ appId = $app.AppId; branchName = $app.Branch; environmentVariables = $merged }
    $payloadPath = Join-Path $env:TEMP "amplify-env-$($app.AppId).json"
    [System.IO.File]::WriteAllText($payloadPath, ($payload | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))

    aws amplify update-branch `
        --cli-input-json "file://$payloadPath" `
        --region $Region 2>&1 | Out-Null

    if ($LASTEXITCODE -eq 0) {
        Write-Success "  [OK] Environment variables updated"

        # Trigger new build
        Write-Host "  Triggering new build..." -ForegroundColor Gray
        aws amplify start-job `
            --app-id $app.AppId `
            --branch-name $app.Branch `
            --job-type RELEASE `
            --region $Region 2>&1 | Out-Null

        if ($LASTEXITCODE -eq 0) {
            Write-Success "  [OK] Build triggered successfully"
            $successCount++
        } else {
            Write-Warn "  [warn] Build trigger failed"
            $failCount++
        }
    } else {
        Write-Err "  [FAIL] Failed to update environment variables"
        $failCount++
    }

    Write-Host ""
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Update Summary" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Success "Successful: $successCount"
if ($failCount -gt 0) {
    Write-Err "Failed: $failCount"
}
Write-Host ""

if ($successCount -gt 0) {
    Write-Info "Builds are running! Monitor progress at:"
    Write-Host "https://$Region.console.aws.amazon.com/amplify/apps" -ForegroundColor Blue
    Write-Host ""
    Write-Warn "Estimated completion: 3-5 minutes"
    Write-Host ""
    Write-Info "After builds complete, your apps will use:"
    Write-Host "  API: $ApiUrl"
    Write-Host ""
}

if ($failCount -gt 0) {
    Write-Host ""
    Write-Warn "Some apps failed to update. Manual fix:"
    Write-Host "1. Go to https://$Region.console.aws.amazon.com/amplify/apps"
    Write-Host "2. Click each app, open Environment Variables"
    Write-Host "3. Set: VITE_API_URL = $ApiUrl"
    Write-Host "4. Save and redeploy"
}
