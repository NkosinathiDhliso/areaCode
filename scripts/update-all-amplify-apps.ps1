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
    [string]$RumAdminIdentityPool = $env:RUM_ADMIN_IDENTITY_POOL,

    # Media CDN base URL (CloudFront in front of the private s3_media bucket).
    # Source: `terraform output -raw media_cdn_url`. Consumed by the Web and
    # Business photo surfaces (the shared mediaUrl helper). Unset -> those
    # surfaces render the explicit "Photos unavailable" state (parity R5).
    [string]$CdnUrl = $env:VITE_CDN_URL,

    # Web Push VAPID public key. Source: the VAPID keypair (Secrets Manager
    # area-code/{env}/vapid). Consumed by the consumer web push opt-in only.
    [string]$VapidPublicKey = $env:VITE_VAPID_PUBLIC_KEY,

    # Cognito Hosted UI (Google OAuth) domains + app-client IDs, one pair per
    # pool. The domain is the pool's Hosted UI domain (e.g.
    # https://area-code-consumer.auth.us-east-1.amazoncognito.com); the client
    # id is each cognito module's `client_id` output. These previously lived
    # only in the Amplify console (untracked drift); the script now owns them
    # so it is the single source of truth (parity R6.1, R6.2).
    [string]$CognitoHostedUiDomainConsumer = $env:VITE_COGNITO_HOSTED_UI_DOMAIN,
    [string]$CognitoClientIdConsumer = $env:VITE_COGNITO_CLIENT_ID_CONSUMER,
    [string]$CognitoHostedUiDomainBusiness = $env:VITE_COGNITO_HOSTED_UI_DOMAIN_BUSINESS,
    [string]$CognitoClientIdBusiness = $env:VITE_COGNITO_CLIENT_ID_BUSINESS,
    [string]$CognitoHostedUiDomainStaff = $env:VITE_COGNITO_HOSTED_UI_DOMAIN_STAFF,
    [string]$CognitoClientIdStaff = $env:VITE_COGNITO_CLIENT_ID_STAFF,
    [string]$CognitoHostedUiDomainAdmin = $env:VITE_COGNITO_HOSTED_UI_DOMAIN_ADMIN,
    [string]$CognitoClientIdAdmin = $env:VITE_COGNITO_CLIENT_ID_ADMIN
)

$ErrorActionPreference = "Stop"

# Color output functions
function Write-Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host $msg -ForegroundColor Green }
function Write-Err($msg) { Write-Host $msg -ForegroundColor Red }
function Write-Warn($msg) { Write-Host $msg -ForegroundColor Yellow }

# Set a managed key on the overlay map only when we actually have a value.
# No-fallbacks (see .kiro/steering/no-fallbacks-no-legacy.md): a missing
# required value is a provisioning gap that is reported loudly, never papered
# over with a silent default. Because we MERGE (below), skipping a key leaves
# any existing console value untouched rather than wiping it.
function Set-ManagedKey($Map, [string]$Key, [string]$Value, [string]$AppName) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        Write-Warn "  [gap] $Key not provided for ${AppName}: leaving any existing Amplify value in place (provisioning gap)"
        return
    }
    $Map[$Key] = $Value
}

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
        VITE_WEBSOCKET_URL = $WebSocketUrl
    }
    # Mapbox: Web (basemap) and Business (address autocomplete via the Mapbox
    # Geocoding API) both read it.
    if ($app.Name -eq "Web (Main)" -or $app.Name -eq "Business") {
        Set-ManagedKey $managed 'VITE_MAPBOX_TOKEN' $MapboxToken $app.Name
    }
    # The Business dashboard generates staff invite links pointing at the staff
    # portal. Give it the staff origin explicitly so the link never depends on a
    # `business.`->`staff.` hostname swap.
    if ($app.Name -eq "Business") {
        $managed['VITE_STAFF_URL'] = "https://staff.areacode.co.za"
    }

    # Media CDN base URL: read by the shared mediaUrl helper on the photo
    # surfaces. Only the Web (consumer venue detail) and Business (node editor,
    # dashboard) apps render venue photos, so only they get the key.
    if ($app.Name -eq "Web (Main)" -or $app.Name -eq "Business") {
        Set-ManagedKey $managed 'VITE_CDN_URL' $CdnUrl $app.Name
    }

    # Web Push VAPID public key: only the consumer web app subscribes to push.
    if ($app.Name -eq "Web (Main)") {
        Set-ManagedKey $managed 'VITE_VAPID_PUBLIC_KEY' $VapidPublicKey $app.Name
    }

    # Cognito Hosted UI (Google OAuth) keys, one pair per portal. Each portal
    # has its own pool and reads its own suffixed keys. The Business portal also
    # drives the Staff OAuth callback (staff-invite acceptance), so it carries
    # the staff pool keys in addition to its own.
    switch ($app.Name) {
        "Web (Main)" {
            Set-ManagedKey $managed 'VITE_COGNITO_HOSTED_UI_DOMAIN' $CognitoHostedUiDomainConsumer $app.Name
            Set-ManagedKey $managed 'VITE_COGNITO_CLIENT_ID_CONSUMER' $CognitoClientIdConsumer $app.Name
        }
        "Admin" {
            Set-ManagedKey $managed 'VITE_COGNITO_HOSTED_UI_DOMAIN_ADMIN' $CognitoHostedUiDomainAdmin $app.Name
            Set-ManagedKey $managed 'VITE_COGNITO_CLIENT_ID_ADMIN' $CognitoClientIdAdmin $app.Name
        }
        "Business" {
            Set-ManagedKey $managed 'VITE_COGNITO_HOSTED_UI_DOMAIN_BUSINESS' $CognitoHostedUiDomainBusiness $app.Name
            Set-ManagedKey $managed 'VITE_COGNITO_CLIENT_ID_BUSINESS' $CognitoClientIdBusiness $app.Name
            Set-ManagedKey $managed 'VITE_COGNITO_HOSTED_UI_DOMAIN_STAFF' $CognitoHostedUiDomainStaff $app.Name
            Set-ManagedKey $managed 'VITE_COGNITO_CLIENT_ID_STAFF' $CognitoClientIdStaff $app.Name
        }
        "Staff" {
            Set-ManagedKey $managed 'VITE_COGNITO_HOSTED_UI_DOMAIN_STAFF' $CognitoHostedUiDomainStaff $app.Name
            Set-ManagedKey $managed 'VITE_COGNITO_CLIENT_ID_STAFF' $CognitoClientIdStaff $app.Name
        }
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
    # keys we own. This script now manages the Cognito Hosted-UI and VAPID keys,
    # but any remaining out-of-band key (e.g. build-time VITE_GIT_SHA, feature
    # flags) must survive the run rather than be silently wiped. Unmanaged keys
    # are preserved AND reported as drift (below).
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

    # DRIFT REPORT: any key already on the Amplify branch that this script does
    # not manage. It is never deleted here (the merge above preserves it); it is
    # surfaced so an operator can decide whether it belongs in the script (parity
    # R6.2) or is stale (the R6.4 diff script formalizes both directions).
    foreach ($k in $merged.Keys) {
        if (-not $managed.Contains($k)) {
            Write-Warn "  [drift] $k is set on Amplify but not managed by this script"
        }
    }

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
