#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Apply the Amplify custom rules (rewrites) for all four Area Code apps.

.DESCRIPTION
    This is the single source of truth for Amplify custom rules. It replaces the
    former pair of scripts (add-spa-rewrites.ps1 + apply-amplify-spa-rewrites.ps1)
    that both wrote the same `amplify update-app --custom-rules` field and
    disagreed about its contents (dry-reuse-no-duplication.md).

    Rules are ORDER SENSITIVE. Amplify evaluates them top to bottom and stops at
    the first match, so every specific rewrite must sit ahead of the SPA
    fallback, which matches nearly every extensionless path.

    Per app:
      web       /api/<*>   ->  API Gateway               (Spotify OAuth callback)
                /node/<*>  ->  GET /v1/share/node/<*>    (Share_Preview, OG tags)
                SPA fallback -> /index.html
      business  /api/<*>, SPA fallback
      staff     /api/<*>, SPA fallback
      admin     /api/<*>, SPA fallback

    The /node/<*> rewrite is consumer-only on purpose: the Share_Preview route
    renders venue OG tags for link unfurlers (WhatsApp) and then redirects the
    visitor to /map?venue={slug}&src=share, which only the consumer app serves
    (proof-of-demand R12.2).

    JSON is always passed to the AWS CLI through a file. PowerShell mangles
    inline JSON arguments (see rules/tech.md, "Common gotchas").

    Safe to re-run: update-app replaces the whole rule set, so the run is
    idempotent. No rebuild needed, rules take effect immediately.

    Requires: AWS CLI configured with credentials that can call amplify:UpdateApp.

.PARAMETER DryRun
    Print the rule set each app would receive and exit without calling AWS.
#>

param(
    [string]$Region = "us-east-1",
    # Host that serves the REST API (custom domain). Target of the share rewrite.
    [string]$ApiHost = "api.areacode.co.za",
    # Origin the /api/<*> proxy forwards to. The Spotify dashboard redirect URI is
    # https://areacode.co.za/api/v1/streaming/spotify/callback, so the consumer
    # origin must proxy to the HTTP API.
    [string]$ApiProxyOrigin = "https://iyj02gvt12.execute-api.us-east-1.amazonaws.com",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host $msg -ForegroundColor Green }
function Write-Err($msg) { Write-Host $msg -ForegroundColor Red }

# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------

# SPA fallback: any path without a known static-asset extension serves
# index.html with a 200 so the client router owns the route.
# Source: https://docs.aws.amazon.com/amplify/latest/userguide/redirects.html
$spaFallbackRule = [ordered]@{
    source = "</^[^.]+$|\.(?!(css|gif|ico|jpg|jpeg|js|png|txt|xml|svg|woff|woff2|ttf|map|json|webmanifest|webp|avif)$)([^.]+$)/>"
    target = "/index.html"
    status = "200"
}

# API proxy: forwards /api/* to the API Gateway so the Spotify OAuth callback
# resolves on the app origin.
$apiProxyRule = [ordered]@{
    source = "/api/<*>"
    target = "$ApiProxyOrigin/<*>"
    status = "200"
}

# Share_Preview: /node/{slug} is served by the API Lambda so link unfurlers read
# real OG tags instead of the SPA shell. Must precede the SPA fallback.
$shareRule = [ordered]@{
    source = "/node/<*>"
    target = "https://$ApiHost/v1/share/node/<*>"
    status = "200"
}

# Mirrors infra/environments/prod/main.tf
$amplifyApps = @(
    @{ Name = "web"; AppId = "d3pm78r41ma6w6"; Rules = @($apiProxyRule, $shareRule, $spaFallbackRule) },
    @{ Name = "business"; AppId = "dbp54yxhyjvk0"; Rules = @($apiProxyRule, $spaFallbackRule) },
    @{ Name = "staff"; AppId = "d166bb81tg4k61"; Rules = @($apiProxyRule, $spaFallbackRule) },
    @{ Name = "admin"; AppId = "d1ay6jict0ql9w"; Rules = @($apiProxyRule, $spaFallbackRule) }
)

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Applying Amplify custom rules" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Info "Region:         $Region"
Write-Info "Share target:   https://$ApiHost/v1/share/node/<*>"
Write-Info "API proxy:      $ApiProxyOrigin/<*>"
if ($DryRun) { Write-Info "Mode:           dry run (no AWS calls)" }
Write-Host ""

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$successCount = 0
$failCount = 0

foreach ($app in $amplifyApps) {
    Write-Info "Updating Amplify app '$($app.Name)' ($($app.AppId))"
    foreach ($rule in $app.Rules) {
        Write-Host "    $($rule.status)  $($rule.source)  ->  $($rule.target)" -ForegroundColor Gray
    }

    # File-based JSON: PowerShell mangles inline JSON passed to the AWS CLI.
    $payload = [ordered]@{ appId = $app.AppId; customRules = @($app.Rules) }
    $payloadPath = Join-Path ([System.IO.Path]::GetTempPath()) "amplify-rules-$($app.AppId).json"
    [System.IO.File]::WriteAllText($payloadPath, ($payload | ConvertTo-Json -Depth 10), $utf8NoBom)

    if ($DryRun) {
        Write-Host ([System.IO.File]::ReadAllText($payloadPath)) -ForegroundColor DarkGray
        Remove-Item $payloadPath -ErrorAction SilentlyContinue
        $successCount++
        Write-Host ""
        continue
    }

    $result = aws amplify update-app `
        --cli-input-json "file://$payloadPath" `
        --region $Region `
        --output text 2>&1
    $exit = $LASTEXITCODE
    Remove-Item $payloadPath -ErrorAction SilentlyContinue

    if ($exit -eq 0) {
        Write-Success "  [OK] rules applied"
        $successCount++
    } else {
        Write-Err "  [FAIL] $result"
        $failCount++
    }
    Write-Host ""
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Success "$successCount / $($amplifyApps.Count) apps updated"
if ($failCount -gt 0) {
    Write-Err "$failCount failed"
    exit 1
}
Write-Host ""
if (-not $DryRun) {
    Write-Info "No rebuild needed. Rules take effect immediately."
    Write-Info "Verify: curl -fsS -H 'User-Agent: WhatsApp/2' https://areacode.co.za/node/<slug> | Select-String 'og:title'"
    Write-Host ""
}
