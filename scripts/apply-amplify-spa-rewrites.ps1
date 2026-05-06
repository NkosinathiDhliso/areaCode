# Apply SPA rewrite rule to all Amplify apps so deep links (/profile, /map, etc.) don't 404.
# Run once after the apps are created. Safe to re-run; it overwrites existing rules.
#
# Requires: AWS CLI configured with credentials that can call amplify:UpdateApp.
#
# What this does:
#   For each Amplify app, set a custom rewrite rule that redirects any non-asset 404
#   to /index.html with a 200 status, so the SPA router can handle the route.
#
# The regex matches paths that:
#   - Have NO dot in them, OR
#   - Have a dot but the extension is NOT a known static asset extension.
# This matches deep links like /profile?streaming=success while letting real
# static files (js, css, png, etc.) 404 normally if missing.

param(
    [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Stop"

# Mirrors infra/environments/prod/main.tf
$apps = @(
    @{ Name = "web";      Id = "d3pm78r41ma6w6" },
    @{ Name = "business"; Id = "dbp54yxhyjvk0" },
    @{ Name = "staff";    Id = "d166bb81tg4k61" },
    @{ Name = "admin";    Id = "d1ay6jict0ql9w" }
)

# The Amplify-recommended SPA fallback rewrite.
# Source: https://docs.aws.amazon.com/amplify/latest/userguide/redirects.html#redirects-for-single-page-web-apps-spa
$spaRule = @{
    source = '</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>'
    target = "/index.html"
    status = "404-200"
}

# API proxy rule: forward /api/* to the API Gateway so Spotify callback works at
# https://areacode.co.za/api/v1/streaming/spotify/callback
$apiProxyRule = @{
    source = "/api/<*>"
    target = "https://iyj02gvt12.execute-api.us-east-1.amazonaws.com/<*>"
    status = "200"
}

$rules = @($apiProxyRule, $spaRule)
$rulesJson = ($rules | ConvertTo-Json -Compress -AsArray)

foreach ($app in $apps) {
    Write-Host "→ Updating Amplify app '$($app.Name)' ($($app.Id))..." -ForegroundColor Cyan
    aws amplify update-app `
        --app-id $app.Id `
        --region $Region `
        --custom-rules $rulesJson `
        | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ✗ Failed to update $($app.Name)" -ForegroundColor Red
        exit 1
    }
    Write-Host "  ✓ Done" -ForegroundColor Green
}

Write-Host ""
Write-Host "All Amplify apps updated with SPA fallback + /api proxy rules." -ForegroundColor Green
Write-Host "Deep links like https://areacode.co.za/profile will now serve index.html." -ForegroundColor Green
