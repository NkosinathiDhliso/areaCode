# Go-Live Readiness Verification for Area Code
# One-command launch verification. Read-only by construction: HTTP GETs and
# AWS CLI list/get/describe calls only, never put/update/delete/invoke.
#
# Usage:
#   ./scripts/go-live-check.ps1 -Environment prod
#
# Spec: .kiro/specs/go-live-readiness
# PowerShell 5.1 constraints (binding): no &&/||, no ternary, TLS 1.2 set
# before any HTTPS call, AWS CLI parsed via --output json + ConvertFrom-Json,
# native stderr is not redirected with 2>&1.
param(
    [string]$Environment = "prod",
    [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Stop"

# PowerShell 5.1 defaults to TLS 1.0; force TLS 1.2 before any HTTPS call so
# Invoke-RestMethod / Invoke-WebRequest can reach the prod endpoints.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RootDir = Split-Path $PSScriptRoot -Parent

# Failure counter. Any [FAIL] increments this; the script exits 1 when it is
# greater than zero. WARNs and MANUAL lines never change the exit code.
$script:failures = 0

# Write-Check emits the one-line-per-check output contract:
#   [PASS] name: observed
#   [FAIL] name: observed (expected ...)
#   [WARN] name: observed
#   [MANUAL] name: not verifiable by script
# Status must be one of PASS, FAIL, WARN, MANUAL. FAIL increments $script:failures.
function Write-Check {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("PASS", "FAIL", "WARN", "MANUAL")]
        [string]$Status,

        [Parameter(Mandatory = $true)]
        [string]$Name,

        [string]$Detail = ""
    )

    $color = "Gray"
    if ($Status -eq "PASS") { $color = "Green" }
    if ($Status -eq "FAIL") { $color = "Red" }
    if ($Status -eq "WARN") { $color = "Yellow" }
    if ($Status -eq "MANUAL") { $color = "Cyan" }

    $line = "[$Status] $Name"
    if ($Detail -ne "") { $line = "$line`: $Detail" }

    Write-Host $line -ForegroundColor $color

    if ($Status -eq "FAIL") { $script:failures++ }
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Area Code - Go-Live Readiness Check" -ForegroundColor Cyan
Write-Host "  Environment: $Environment" -ForegroundColor Cyan
Write-Host "  Region: $Region" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ── HTTP checks (Task 2: checklist §2 items 1-2, §3) ─────────────────────────
# 2.1 API health, 2.2 nodes seeded + JHB bounding box, 2.3 portals up + HTTP->HTTPS redirect.
Write-Host "HTTP checks" -ForegroundColor Yellow

# 2.1 API health: GET https://api.areacode.co.za/health, assert status=ok, env=prod.
# $ErrorActionPreference is Stop, so wrap the HTTP call in try/catch to turn a
# network/DNS/TLS failure into a [FAIL] line instead of an unhandled exception.
try {
    $health = Invoke-RestMethod -Uri "https://api.areacode.co.za/health"
    $observedStatus = $health.status
    $observedEnv = $health.env
    if ($observedStatus -eq "ok" -and $observedEnv -eq "prod") {
        Write-Check -Status "PASS" -Name "API health" -Detail "status=$observedStatus, env=$observedEnv"
    }
    else {
        $detail = "status=$observedStatus, env=$observedEnv (expected status=ok, env=prod)"
        Write-Check -Status "FAIL" -Name "API health" -Detail $detail
    }
}
catch {
    Write-Check -Status "FAIL" -Name "API health" -Detail "request failed: $($_.Exception.Message)"
}

# 2.2 Nodes seeded + JHB bounding box. The public GET /v1/nodes/johannesburg
# read is a bare array; it is filtered server-side to active, paid-tier venues
# (backend/src/features/nodes/repository.ts getNodesByCitySlug), so the payload
# fields are id, name, slug, category, lat, lng, claimStatus, nodeColour,
# nodeIcon, isVerified, headerImageKey, businessTier. Note: the public payload
# does NOT carry an isActive field (only active nodes are returned), so we
# assert isActive when it is present and otherwise treat presence in the list
# as active. JHB bounding box: lat -26.5..-25.9, lng 27.7..28.4.
try {
    $nodesResponse = Invoke-RestMethod -Uri "https://api.areacode.co.za/v1/nodes/johannesburg"

    # Normalise to an array. The route returns a bare array today, but tolerate
    # an object wrapper (nodes/data) so a future shape change is handled, not
    # silently mis-counted.
    $nodes = $nodesResponse
    if ($null -ne $nodesResponse -and $nodesResponse.PSObject.Properties.Name -contains "nodes") {
        $nodes = $nodesResponse.nodes
    }
    elseif ($null -ne $nodesResponse -and $nodesResponse.PSObject.Properties.Name -contains "data") {
        $nodes = $nodesResponse.data
    }
    $nodes = @($nodes)
    $nodeCount = $nodes.Count

    # Count gate: FAIL under 5 (below checklist minimum), WARN at exactly 5
    # (minimum met, no margin), PASS above 5.
    if ($nodeCount -lt 5) {
        Write-Check -Status "FAIL" -Name "Nodes count" -Detail "$nodeCount nodes (expected >= 5)"
    }
    elseif ($nodeCount -eq 5) {
        Write-Check -Status "WARN" -Name "Nodes count" -Detail "$nodeCount nodes (minimum met, no margin)"
    }
    else {
        Write-Check -Status "PASS" -Name "Nodes count" -Detail "$nodeCount nodes"
    }

    # Per-node: assert active + coordinates inside the JHB bounding box. Collect
    # every offending node so the report names each one, not just the first.
    $badNodes = @()
    foreach ($node in $nodes) {
        # Presence in the public list already implies active (server filters
        # isActive = true); only an explicit isActive = false counts as inactive.
        $isActive = $true
        if ($node.PSObject.Properties.Name -contains "isActive") { $isActive = [bool]$node.isActive }

        $lat = $node.lat
        $lng = $node.lng
        $latOk = ($lat -ge -26.5) -and ($lat -le -25.9)
        $lngOk = ($lng -ge 27.7) -and ($lng -le 28.4)

        if (-not ($isActive -and $latOk -and $lngOk)) {
            $label = $node.name
            if ([string]::IsNullOrEmpty($label)) { $label = $node.id }
            $badNodes += "$label (isActive=$isActive, lat=$lat, lng=$lng)"
        }
    }

    if ($badNodes.Count -eq 0) {
        $okDetail = "all $nodeCount node(s) active with coords in JHB box"
        Write-Check -Status "PASS" -Name "Nodes active + in JHB box" -Detail $okDetail
    }
    else {
        $badDetail = "$($badNodes.Count) node(s) failed: " + ($badNodes -join "; ")
        Write-Check -Status "FAIL" -Name "Nodes active + in JHB box" -Detail $badDetail
    }
}
catch {
    Write-Check -Status "FAIL" -Name "Nodes seeded" -Detail "request failed: $($_.Exception.Message)"
}

# 2.3 Portals up + HTTP->HTTPS redirect. The four Amplify portals are the
# consumer app (apex areacode.co.za) plus the business, staff, and admin
# subdomains (see scripts/update-all-amplify-apps.ps1 for the app-to-domain
# map). HEAD each over HTTPS and assert 200. Each call is wrapped so a
# network/DNS/TLS failure or a non-2xx status becomes a [FAIL] line rather than
# an unhandled exception ($ErrorActionPreference is Stop).
$portalUrls = @(
    "https://areacode.co.za",
    "https://business.areacode.co.za",
    "https://staff.areacode.co.za",
    "https://admin.areacode.co.za"
)

foreach ($portalUrl in $portalUrls) {
    try {
        $response = Invoke-WebRequest -Method Head -Uri $portalUrl -UseBasicParsing
        $statusCode = [int]$response.StatusCode
        if ($statusCode -eq 200) {
            Write-Check -Status "PASS" -Name "Portal $portalUrl" -Detail "HTTP $statusCode"
        }
        else {
            Write-Check -Status "FAIL" -Name "Portal $portalUrl" -Detail "HTTP $statusCode (expected 200)"
        }
    }
    catch {
        # Invoke-WebRequest throws on non-2xx; recover the status code from the
        # exception response when present so a 4xx/5xx reports its code, not just
        # the exception text.
        $observed = $_.Exception.Message
        $exResponse = $_.Exception.Response
        if ($null -ne $exResponse -and $null -ne $exResponse.StatusCode) {
            $observed = "HTTP $([int]$exResponse.StatusCode)"
        }
        Write-Check -Status "FAIL" -Name "Portal $portalUrl" -Detail "$observed (expected 200)"
    }
}

# HTTPS enforcement: GET http://areacode.co.za WITHOUT following redirects and
# assert a 30x response whose Location header is https. PowerShell 5.1's
# Invoke-WebRequest -MaximumRedirection 0 throws on a 30x without exposing a
# usable response, so use [System.Net.HttpWebRequest] with AllowAutoRedirect
# disabled (a read-only GET) to read the status code and Location cleanly.
try {
    $httpRequest = [System.Net.HttpWebRequest]::Create("http://areacode.co.za")
    $httpRequest.Method = "GET"
    $httpRequest.AllowAutoRedirect = $false
    $httpResponse = $httpRequest.GetResponse()
    try {
        $redirectStatus = [int]$httpResponse.StatusCode
        $location = $httpResponse.Headers["Location"]
        $isRedirect = ($redirectStatus -ge 300) -and ($redirectStatus -lt 400)
        $isHttpsLocation = ($null -ne $location) -and ($location -match "^https://")
        if ($isRedirect -and $isHttpsLocation) {
            $okDetail = "HTTP $redirectStatus -> $location"
            Write-Check -Status "PASS" -Name "HTTP->HTTPS redirect" -Detail $okDetail
        }
        else {
            $badDetail = "HTTP $redirectStatus, Location=$location (expected 30x to https)"
            Write-Check -Status "FAIL" -Name "HTTP->HTTPS redirect" -Detail $badDetail
        }
    }
    finally {
        $httpResponse.Close()
    }
}
catch [System.Net.WebException] {
    # A WebException can still carry the 30x response; inspect it before failing.
    $webResponse = $_.Exception.Response
    if ($null -ne $webResponse) {
        $redirectStatus = [int]$webResponse.StatusCode
        $location = $webResponse.Headers["Location"]
        $isRedirect = ($redirectStatus -ge 300) -and ($redirectStatus -lt 400)
        $isHttpsLocation = ($null -ne $location) -and ($location -match "^https://")
        if ($isRedirect -and $isHttpsLocation) {
            $okDetail = "HTTP $redirectStatus -> $location"
            Write-Check -Status "PASS" -Name "HTTP->HTTPS redirect" -Detail $okDetail
        }
        else {
            $badDetail = "HTTP $redirectStatus, Location=$location (expected 30x to https)"
            Write-Check -Status "FAIL" -Name "HTTP->HTTPS redirect" -Detail $badDetail
        }
        $webResponse.Close()
    }
    else {
        Write-Check -Status "FAIL" -Name "HTTP->HTTPS redirect" -Detail "request failed: $($_.Exception.Message)"
    }
}
catch {
    Write-Check -Status "FAIL" -Name "HTTP->HTTPS redirect" -Detail "request failed: $($_.Exception.Message)"
}

Write-Host ""

# ── AWS state checks (Task 3: read-only, us-east-1) ──────────────────────────
# 3.1 DLQ depth, 3.2 API error log scan, 3.3 Amplify build parity (c047c94),
# 3.4 Cognito consumer pool policy + Google IdP.
Write-Host "AWS state checks" -ForegroundColor Yellow

# One-time AWS CLI availability probe. When the CLI is absent, every AWS check
# below emits a WARN instead of throwing, so the run still completes and reports.
$script:awsAvailable = $null -ne (Get-Command aws -ErrorAction SilentlyContinue)
if (-not $script:awsAvailable) {
    Write-Check -Status "WARN" -Name "AWS CLI" -Detail "aws not found on PATH; AWS state checks skipped"
}

# Invoke-AwsJson runs an `aws` CLI command with --output json and returns the
# parsed object (via ConvertFrom-Json), or $null on ANY failure: CLI absent,
# non-zero exit, empty output, or malformed JSON. It NEVER throws even under
# $ErrorActionPreference = Stop, so callers can WARN/FAIL cleanly. Native stderr
# is discarded with 2>$null (never 2>&1, which would merge error records into
# the object stream and corrupt the JSON). Reused by tasks 3.1-3.4 and 9.
function Invoke-AwsJson {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$AwsArgs
    )

    if (-not $script:awsAvailable) { return $null }

    try {
        $output = & aws @AwsArgs --output json 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        if ($null -eq $output) { return $null }
        $joined = ($output -join "`n").Trim()
        if ($joined -eq "") { return $null }
        return ($joined | ConvertFrom-Json)
    }
    catch {
        return $null
    }
}

# 3.1 DLQ depth: assert ApproximateNumberOfMessages is 0 on each prod DLQ.
# Resolve the queue URL by name, then read the one attribute. A missing queue or
# missing credentials yields $null from Invoke-AwsJson and reports WARN (cannot
# verify), not FAIL; a resolved non-zero depth is a FAIL naming the observed count.
$dlqNames = @(
    "area-code-prod-reward-eval-dlq",
    "area-code-prod-push-sender-dlq",
    "area-code-prod-campaign-send-dlq",
    "area-code-prod-report-generation-dlq"
)

foreach ($dlqName in $dlqNames) {
    if (-not $script:awsAvailable) {
        Write-Check -Status "WARN" -Name "DLQ $dlqName" -Detail "AWS CLI unavailable; not checked"
        continue
    }

    $urlResult = Invoke-AwsJson -AwsArgs @("sqs", "get-queue-url", "--queue-name", $dlqName, "--region", $Region)
    if ($null -eq $urlResult -or [string]::IsNullOrEmpty($urlResult.QueueUrl)) {
        Write-Check -Status "WARN" -Name "DLQ $dlqName" -Detail "could not resolve queue URL (missing queue or credentials)"
        continue
    }

    $attrArgs = @(
        "sqs", "get-queue-attributes",
        "--queue-url", $urlResult.QueueUrl,
        "--attribute-names", "ApproximateNumberOfMessages",
        "--region", $Region
    )
    $attrResult = Invoke-AwsJson -AwsArgs $attrArgs
    if ($null -eq $attrResult -or $null -eq $attrResult.Attributes -or `
            $null -eq $attrResult.Attributes.ApproximateNumberOfMessages) {
        Write-Check -Status "WARN" -Name "DLQ $dlqName" -Detail "could not read queue attributes"
        continue
    }

    $depth = [int]$attrResult.Attributes.ApproximateNumberOfMessages
    if ($depth -eq 0) {
        Write-Check -Status "PASS" -Name "DLQ $dlqName" -Detail "ApproximateNumberOfMessages=0"
    }
    else {
        Write-Check -Status "FAIL" -Name "DLQ $dlqName" -Detail "ApproximateNumberOfMessages=$depth (expected 0)"
    }
}

# 3.2 API error log scan: filter the last 24h of the API Lambda's log group for
# ERROR-level events. FAIL when any event is returned (print the first message);
# PASS when the window is clean. Invoke-AwsJson returns $null when the group is
# not queryable (missing group or credentials), which reports WARN, not FAIL.
# --filter-pattern ERROR is a bare CloudWatch Logs term, not JSON, so the
# PowerShell inline-JSON gotcha does not apply. --start-time is epoch ms.
$apiLogGroup = "/aws/lambda/area-code-prod-api"
if (-not $script:awsAvailable) {
    Write-Check -Status "WARN" -Name "API error logs 24h" -Detail "AWS CLI unavailable; not checked"
}
else {
    $startTimeMs = [DateTimeOffset]::UtcNow.AddHours(-24).ToUnixTimeMilliseconds()
    $logArgs = @(
        "logs", "filter-log-events",
        "--log-group-name", $apiLogGroup,
        "--start-time", "$startTimeMs",
        "--filter-pattern", "ERROR",
        "--max-items", "5",
        "--region", $Region
    )
    $logResult = Invoke-AwsJson -AwsArgs $logArgs
    if ($null -eq $logResult -or $null -eq $logResult.events) {
        Write-Check -Status "WARN" -Name "API error logs 24h" -Detail "log group not queryable (missing group or credentials)"
    }
    else {
        $errorEvents = @($logResult.events)
        if ($errorEvents.Count -eq 0) {
            Write-Check -Status "PASS" -Name "API error logs 24h" -Detail "no ERROR events in last 24h"
        }
        else {
            # Print the first event's message, truncated if very long, so the
            # report shows what failed without flooding the console.
            $firstMessage = "$($errorEvents[0].message)".Trim()
            $maxLen = 200
            if ($firstMessage.Length -gt $maxLen) {
                $firstMessage = $firstMessage.Substring(0, $maxLen) + "..."
            }
            $detail = "$($errorEvents.Count) ERROR event(s) in last 24h; first: $firstMessage"
            Write-Check -Status "FAIL" -Name "API error logs 24h" -Detail $detail
        }
    }
}

# 3.3 Build parity: assert the live Amplify build for each app's production
# branch includes the carousel-confinement fix c047c94. Enumerate apps, read
# the latest job on the production branch, assert it SUCCEEDED, then assert its
# commit is c047c94 or a descendant using the local git clone. A build that
# predates the fix FAILs and names the fix path; an unverifiable SHA WARNs.
$fixCommit = "c047c94"
$amplifyFixPath = "re-run ./scripts/update-all-amplify-apps.ps1 or redeploy from the Amplify console"

# git is only needed for the ancestry assertion; probe once so a missing git
# downgrades parity to WARN (cannot verify) instead of throwing.
$gitAvailable = $null -ne (Get-Command git -ErrorAction SilentlyContinue)

# Test-CommitParity classifies an Amplify job commit against $fixCommit using
# the local clone. Returns one of: "ancestor" (fix is present / commit is the
# fix or a descendant), "predates" (fix is NOT an ancestor, i.e. the build is
# older than the fix), or "unknown" (git absent, a SHA missing from the local
# clone, or any unexpected git result) so the caller can PASS/FAIL/WARN.
function Test-CommitParity {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommitId
    )

    if (-not $gitAvailable) { return "unknown" }
    if ([string]::IsNullOrEmpty($CommitId)) { return "unknown" }

    # Both commits must exist locally before merge-base can be trusted; a SHA
    # not in the clone (fresh/shallow checkout) means we cannot verify parity.
    & git -C $RootDir cat-file -e "$fixCommit^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) { return "unknown" }
    & git -C $RootDir cat-file -e "$CommitId^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) { return "unknown" }

    # Exit 0 => $fixCommit is an ancestor of (or equal to) the build commit.
    # Exit 1 => it is NOT an ancestor (build predates the fix). Any other exit
    # (e.g. 128) is an unexpected git error and downgrades to unknown.
    & git -C $RootDir merge-base --is-ancestor $fixCommit $CommitId 2>$null
    if ($LASTEXITCODE -eq 0) { return "ancestor" }
    if ($LASTEXITCODE -eq 1) { return "predates" }
    return "unknown"
}

if (-not $script:awsAvailable) {
    Write-Check -Status "WARN" -Name "Amplify build parity" -Detail "AWS CLI unavailable; not checked"
}
else {
    $appsResult = Invoke-AwsJson -AwsArgs @("amplify", "list-apps", "--region", $Region)
    if ($null -eq $appsResult -or $null -eq $appsResult.apps) {
        Write-Check -Status "WARN" -Name "Amplify build parity" -Detail "could not list apps (missing permissions or credentials)"
    }
    else {
        $apps = @($appsResult.apps)
        if ($apps.Count -eq 0) {
            Write-Check -Status "WARN" -Name "Amplify build parity" -Detail "no Amplify apps returned"
        }

        if (-not $gitAvailable) {
            Write-Check -Status "WARN" -Name "Amplify build parity (git)" -Detail "git not on PATH; commit ancestry cannot be verified"
        }

        foreach ($app in $apps) {
            $appName = $app.name
            if ([string]::IsNullOrEmpty($appName)) { $appName = $app.appId }

            # Production branch: prefer the app's declared productionBranch,
            # default to master when the field is absent (matches the four
            # apps in update-all-amplify-apps.ps1).
            $branch = "master"
            if ($null -ne $app.productionBranch -and `
                    -not [string]::IsNullOrEmpty($app.productionBranch.branchName)) {
                $branch = $app.productionBranch.branchName
            }

            $jobsArgs = @(
                "amplify", "list-jobs",
                "--app-id", $app.appId,
                "--branch-name", $branch,
                "--max-items", "1",
                "--region", $Region
            )
            $jobsResult = Invoke-AwsJson -AwsArgs $jobsArgs
            if ($null -eq $jobsResult -or $null -eq $jobsResult.jobSummaries) {
                Write-Check -Status "WARN" -Name "Amplify $appName ($branch)" -Detail "could not list jobs (branch missing or no permissions)"
                continue
            }

            $jobs = @($jobsResult.jobSummaries)
            if ($jobs.Count -eq 0) {
                $detail = "no job has run on branch $branch (expected SUCCEED); fix: $amplifyFixPath"
                Write-Check -Status "FAIL" -Name "Amplify $appName ($branch)" -Detail $detail
                continue
            }

            $latestJob = $jobs[0]
            $jobStatus = $latestJob.status
            if ($jobStatus -ne "SUCCEED") {
                $detail = "latest job status=$jobStatus (expected SUCCEED); fix: $amplifyFixPath"
                Write-Check -Status "FAIL" -Name "Amplify $appName ($branch)" -Detail $detail
                continue
            }

            $commitId = $latestJob.commitId
            $shortSha = "unknown"
            if (-not [string]::IsNullOrEmpty($commitId)) {
                $shortSha = $commitId.Substring(0, [Math]::Min(7, $commitId.Length))
            }

            $parity = Test-CommitParity -CommitId $commitId
            if ($parity -eq "ancestor") {
                $detail = "SUCCEED at $shortSha (includes $fixCommit)"
                Write-Check -Status "PASS" -Name "Amplify $appName ($branch)" -Detail $detail
            }
            elseif ($parity -eq "predates") {
                $detail = "SUCCEED at $shortSha predates fix $fixCommit; fix: $amplifyFixPath"
                Write-Check -Status "FAIL" -Name "Amplify $appName ($branch)" -Detail $detail
            }
            else {
                $detail = "SUCCEED at $shortSha; cannot verify against $fixCommit (SHA not in local clone or git unavailable)"
                Write-Check -Status "WARN" -Name "Amplify $appName ($branch)" -Detail $detail
            }
        }
    }
}

Write-Host ""

# ── Backend end-to-end sweep (Task 9: read-only, us-east-1) ──────────────────
# Covers the backend surface not exercised by §2/§3 so this script is the single
# source of "backend + deployment truth": 9.1 WebSocket handshake reachability,
# 9.2 all four Cognito pools (consumer/business/staff/admin), 9.3 worker log
# ERROR scan. Same [PASS]/[FAIL]/[WARN] contract; no mutations. Reuses the
# existing Write-Check, Invoke-AwsJson, $script:awsAvailable, $RootDir, $Region.
Write-Host "Backend end-to-end sweep" -ForegroundColor Yellow

# 9.1 WebSocket reachability: open a read-only handshake to the prod WebSocket
# API Gateway URL and assert it reaches State=Open, then close immediately. The
# $connect route has no authorizer, so an unauthenticated handshake is expected
# to open. The URL is resolved WITHOUT hardcoding: AREA_CODE_WEBSOCKET_URL env
# var, then VITE_WEBSOCKET_URL (the frontend var), then the prod Terraform
# output `websocket_api_endpoint`. An unresolved URL is a WARN (cannot verify
# locally), never a FAIL.

# Resolve-WebSocketUrl returns the wss URL string, or $null when unresolved.
# Order: AREA_CODE_WEBSOCKET_URL, VITE_WEBSOCKET_URL, then `terraform output
# -raw websocket_api_endpoint` from the prod env dir. Guards for terraform not
# on PATH and the prod env dir missing; uses 2>$null (never 2>&1).
function Resolve-WebSocketUrl {
    $fromEnv = $env:AREA_CODE_WEBSOCKET_URL
    if (-not [string]::IsNullOrEmpty($fromEnv)) { return $fromEnv.Trim() }

    $fromVite = $env:VITE_WEBSOCKET_URL
    if (-not [string]::IsNullOrEmpty($fromVite)) { return $fromVite.Trim() }

    $terraformAvailable = $null -ne (Get-Command terraform -ErrorAction SilentlyContinue)
    if (-not $terraformAvailable) { return $null }

    $prodEnvDir = Join-Path $RootDir "infra/environments/prod"
    if (-not (Test-Path $prodEnvDir)) { return $null }

    try {
        $tfOutput = & terraform "-chdir=$prodEnvDir" output -raw websocket_api_endpoint 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        if ($null -eq $tfOutput) { return $null }
        $url = ($tfOutput -join "`n").Trim()
        if ($url -eq "") { return $null }
        return $url
    }
    catch {
        return $null
    }
}

$wsUrl = Resolve-WebSocketUrl
if ([string]::IsNullOrEmpty($wsUrl)) {
    $detail = "URL unresolved (set AREA_CODE_WEBSOCKET_URL or VITE_WEBSOCKET_URL, or run from a clone with terraform + prod state); not checked"
    Write-Check -Status "WARN" -Name "WebSocket reachability" -Detail $detail
}
else {
    # ClientWebSocket handshake with a ~10s timeout. Everything is wrapped so any
    # failure (DNS/TLS/timeout/handshake reject) becomes a [FAIL] line, never an
    # unhandled throw. .Wait() surfaces the cause as an AggregateException.
    $ws = $null
    $cts = $null
    try {
        $ws = New-Object System.Net.WebSockets.ClientWebSocket
        $cts = New-Object System.Threading.CancellationTokenSource
        $cts.CancelAfter(10000)
        $uri = New-Object System.Uri($wsUrl)
        $connectTask = $ws.ConnectAsync($uri, $cts.Token)
        $connectTask.Wait()

        if ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
            Write-Check -Status "PASS" -Name "WebSocket reachability" -Detail "handshake opened (State=Open) at $wsUrl"

            # Read-only probe: close the socket immediately.
            $closeCts = New-Object System.Threading.CancellationTokenSource
            $closeCts.CancelAfter(5000)
            try {
                $closeTask = $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "go-live-check", $closeCts.Token)
                $closeTask.Wait()
            }
            catch {
                # A close-handshake hiccup is irrelevant to reachability; ignore.
            }
            finally {
                $closeCts.Dispose()
            }
        }
        else {
            Write-Check -Status "FAIL" -Name "WebSocket reachability" -Detail "connection state=$($ws.State) (expected Open) at $wsUrl"
        }
    }
    catch {
        $msg = $_.Exception.Message
        if ($null -ne $_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
        Write-Check -Status "FAIL" -Name "WebSocket reachability" -Detail "handshake failed: $msg"
    }
    finally {
        if ($null -ne $ws) { $ws.Dispose() }
        if ($null -ne $cts) { $cts.Dispose() }
    }
}

# 9.2 All four Cognito pools (consumer/business/staff/admin). Consolidates the
# former inline 3.4 consumer-only check into ONE shared helper run over the pool
# list (DRY: the consumer pool is checked here, not twice). Each pool id is
# resolved WITHOUT hardcoding: env var AREA_CODE_COGNITO_<POOL>_USER_POOL_ID
# first, then the prod Terraform output `cognito_<pool>_pool_id`.
#
# MFA scoping (Req 1.3): MFA-not-required applies to the CONSUMER pool only
# (FAIL if consumer MfaConfiguration=ON). For business/staff/admin, MFA=ON is an
# acceptable stronger posture and is reported PASS/informational, never a FAIL.
# Google IdP is expected on all four (tech.md); a pool legitimately lacking it
# is a WARN, not a FAIL.

# Resolve-PoolId returns the pool id string for the given pool, or $null when
# unresolved. Order: AREA_CODE_COGNITO_<POOL>_USER_POOL_ID env var, then
# `terraform output -raw cognito_<pool>_pool_id` from the prod env dir. Guards
# for terraform not on PATH and the prod env dir missing; uses 2>$null.
function Resolve-PoolId {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Pool
    )

    $envVarName = "AREA_CODE_COGNITO_$($Pool.ToUpper())_USER_POOL_ID"
    $fromEnv = [Environment]::GetEnvironmentVariable($envVarName)
    if (-not [string]::IsNullOrEmpty($fromEnv)) { return $fromEnv.Trim() }

    $terraformAvailable = $null -ne (Get-Command terraform -ErrorAction SilentlyContinue)
    if (-not $terraformAvailable) { return $null }

    $prodEnvDir = Join-Path $RootDir "infra/environments/prod"
    if (-not (Test-Path $prodEnvDir)) { return $null }

    try {
        $outputName = "cognito_$($Pool)_pool_id"
        $tfOutput = & terraform "-chdir=$prodEnvDir" output -raw $outputName 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        if ($null -eq $tfOutput) { return $null }
        $poolId = ($tfOutput -join "`n").Trim()
        if ($poolId -eq "") { return $null }
        return $poolId
    }
    catch {
        return $null
    }
}

# Test-CognitoPool runs the password-policy, MFA, and Google-IdP checks for one
# pool. $AssertMfaNotRequired is $true only for the consumer pool (Req 1.3); for
# the other pools MFA=ON is reported informationally and never fails the run.
# Unresolved id / missing permission / absent field all WARN, never FAIL.
function Test-CognitoPool {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Pool,

        [Parameter(Mandatory = $true)]
        [bool]$AssertMfaNotRequired
    )

    $label = "Cognito $Pool pool"

    if (-not $script:awsAvailable) {
        Write-Check -Status "WARN" -Name $label -Detail "AWS CLI unavailable; not checked"
        return
    }

    $poolId = Resolve-PoolId -Pool $Pool
    if ([string]::IsNullOrEmpty($poolId)) {
        $envVarName = "AREA_CODE_COGNITO_$($Pool.ToUpper())_USER_POOL_ID"
        $detail = "pool id unresolved (set $envVarName or run from a clone with terraform + prod state); not checked"
        Write-Check -Status "WARN" -Name $label -Detail $detail
        return
    }

    # describe-user-pool: password policy MinimumLength >= 8, plus MFA posture.
    $poolResult = Invoke-AwsJson -AwsArgs @("cognito-idp", "describe-user-pool", "--user-pool-id", $poolId, "--region", $Region)
    if ($null -eq $poolResult -or $null -eq $poolResult.UserPool) {
        Write-Check -Status "WARN" -Name $label -Detail "could not describe user pool $poolId (missing permission or credentials)"
    }
    else {
        $userPool = $poolResult.UserPool

        # Password policy minimum length. Absent means we cannot assert it.
        $minLength = $null
        if ($null -ne $userPool.Policies -and $null -ne $userPool.Policies.PasswordPolicy -and `
                $null -ne $userPool.Policies.PasswordPolicy.MinimumLength) {
            $minLength = [int]$userPool.Policies.PasswordPolicy.MinimumLength
        }

        if ($null -eq $minLength) {
            Write-Check -Status "WARN" -Name "Cognito $Pool password min length" -Detail "MinimumLength not present in describe-user-pool output"
        }
        elseif ($minLength -ge 8) {
            Write-Check -Status "PASS" -Name "Cognito $Pool password min length" -Detail "MinimumLength=$minLength (>= 8)"
        }
        else {
            Write-Check -Status "FAIL" -Name "Cognito $Pool password min length" -Detail "MinimumLength=$minLength (expected >= 8)"
        }

        # MFA: MfaConfiguration is OFF, OPTIONAL, or ON. Absent defaults to OFF.
        $mfa = $userPool.MfaConfiguration
        if ([string]::IsNullOrEmpty($mfa)) { $mfa = "OFF" }
        if ($AssertMfaNotRequired) {
            # Consumer pool (Req 1.3): MFA must NOT be required. Required (ON) FAILs.
            if ($mfa -eq "ON") {
                Write-Check -Status "FAIL" -Name "Cognito $Pool MFA not required" -Detail "MfaConfiguration=$mfa (expected OFF or OPTIONAL)"
            }
            else {
                Write-Check -Status "PASS" -Name "Cognito $Pool MFA not required" -Detail "MfaConfiguration=$mfa"
            }
        }
        else {
            # Business/staff/admin: MFA=ON is an acceptable stronger posture, never a FAIL.
            Write-Check -Status "PASS" -Name "Cognito $Pool MFA" -Detail "MfaConfiguration=$mfa (informational; stronger posture allowed)"
        }
    }

    # list-identity-providers: Google expected on all four (tech.md). A pool
    # legitimately lacking it is a WARN, not a FAIL.
    $idpResult = Invoke-AwsJson -AwsArgs @("cognito-idp", "list-identity-providers", "--user-pool-id", $poolId, "--region", $Region)
    if ($null -eq $idpResult -or $null -eq $idpResult.Providers) {
        Write-Check -Status "WARN" -Name "Cognito $Pool Google IdP" -Detail "could not list identity providers for $poolId (missing permission or credentials)"
    }
    else {
        $providers = @($idpResult.Providers)
        $hasGoogle = $false
        foreach ($provider in $providers) {
            if ($provider.ProviderType -eq "Google" -or $provider.ProviderName -eq "Google") {
                $hasGoogle = $true
            }
        }
        if ($hasGoogle) {
            Write-Check -Status "PASS" -Name "Cognito $Pool Google IdP" -Detail "Google identity provider configured"
        }
        else {
            $names = ($providers | ForEach-Object { $_.ProviderName }) -join ", "
            if ([string]::IsNullOrEmpty($names)) { $names = "none" }
            Write-Check -Status "WARN" -Name "Cognito $Pool Google IdP" -Detail "Google not found (providers: $names); expected per tech.md"
        }
    }
}

# Consumer is the only pool that asserts MFA-not-required (Req 1.3).
$cognitoPools = @(
    @{ Pool = "consumer"; AssertMfaNotRequired = $true },
    @{ Pool = "business"; AssertMfaNotRequired = $false },
    @{ Pool = "staff"; AssertMfaNotRequired = $false },
    @{ Pool = "admin"; AssertMfaNotRequired = $false }
)
foreach ($poolSpec in $cognitoPools) {
    Test-CognitoPool -Pool $poolSpec.Pool -AssertMfaNotRequired $poolSpec.AssertMfaNotRequired
}

# 9.3 Worker error scan: the same 24h ERROR filter as 3.2, looped over the
# worker log groups. Lambda function names differ from some SQS queue names, so
# the log-group names use the real Lambda names: the campaign worker Lambda is
# `campaign-sender` (queue: campaign-send) and the report worker Lambda is
# `report-generator` (queue: report-generation). There is NO push-sender worker
# Lambda (the push-sender SQS queue is drained by the campaign-sender Lambda),
# so no `area-code-prod-push-sender` log group exists and none is scanned.
# FAIL when a group returns an ERROR event (print group + first event); PASS
# when clean; WARN when a group is not queryable.
$workerLogGroups = @(
    "/aws/lambda/area-code-prod-reward-evaluator",
    "/aws/lambda/area-code-prod-presence-expiry",
    "/aws/lambda/area-code-prod-pulse-decay",
    "/aws/lambda/area-code-prod-campaign-sender",
    "/aws/lambda/area-code-prod-report-generator"
)

foreach ($workerLogGroup in $workerLogGroups) {
    if (-not $script:awsAvailable) {
        Write-Check -Status "WARN" -Name "Worker errors $workerLogGroup" -Detail "AWS CLI unavailable; not checked"
        continue
    }

    $workerStartMs = [DateTimeOffset]::UtcNow.AddHours(-24).ToUnixTimeMilliseconds()
    $workerArgs = @(
        "logs", "filter-log-events",
        "--log-group-name", $workerLogGroup,
        "--start-time", "$workerStartMs",
        "--filter-pattern", "ERROR",
        "--max-items", "5",
        "--region", $Region
    )
    $workerResult = Invoke-AwsJson -AwsArgs $workerArgs
    if ($null -eq $workerResult -or $null -eq $workerResult.events) {
        Write-Check -Status "WARN" -Name "Worker errors $workerLogGroup" -Detail "log group not queryable (missing group or credentials)"
    }
    else {
        $workerEvents = @($workerResult.events)
        if ($workerEvents.Count -eq 0) {
            Write-Check -Status "PASS" -Name "Worker errors $workerLogGroup" -Detail "no ERROR events in last 24h"
        }
        else {
            $firstMessage = "$($workerEvents[0].message)".Trim()
            $maxLen = 200
            if ($firstMessage.Length -gt $maxLen) {
                $firstMessage = $firstMessage.Substring(0, $maxLen) + "..."
            }
            $detail = "$($workerEvents.Count) ERROR event(s) in last 24h; first: $firstMessage"
            Write-Check -Status "FAIL" -Name "Worker errors $workerLogGroup" -Detail $detail
        }
    }
}

Write-Host ""

# ── Seed-data readiness report (Task 4) ──────────────────────────────────────
# Per Johannesburg node: name, isActive, has-coords, live reward count,
# has-First-Get. FAIL when no venue has a First-Get; WARN on zero live rewards.
Write-Host "Seed-data readiness" -ForegroundColor Yellow

# Re-fetch the Johannesburg nodes here so the report stands on its own (Task 2.2
# set $nodes inside its own try/catch and a failure there must not silently skew
# this section). A fetch failure is surfaced as a [FAIL] line, not an exception
# ($ErrorActionPreference is Stop). Per node this reads the public per-node
# rewards endpoint GET /v1/nodes/:nodeId/rewards, which returns { items: [...] }
# already filtered to active rewards
# (backend/src/features/nodes/handler.ts -> service.getNodeRewards ->
# rewards/dynamodb-repository.getActiveRewardsByNodeId). So items.Count is the
# live reward count and any item with isFirstGet=$true is a First-Get
# (backend/src/features/rewards/types.ts: isFirstGet: z.boolean().optional()).
try {
    $seedResponse = Invoke-RestMethod -Uri "https://api.areacode.co.za/v1/nodes/johannesburg"

    # Normalise to an array, mirroring Task 2.2 (bare array today; tolerate a
    # nodes/data wrapper so a future shape change is handled, not mis-counted).
    $seedNodes = $seedResponse
    if ($null -ne $seedResponse -and $seedResponse.PSObject.Properties.Name -contains "nodes") {
        $seedNodes = $seedResponse.nodes
    }
    elseif ($null -ne $seedResponse -and $seedResponse.PSObject.Properties.Name -contains "data") {
        $seedNodes = $seedResponse.data
    }
    $seedNodes = @($seedNodes)

    # City-level accumulators: does any venue carry a First-Get (Req 3.3), and
    # which venues have zero live rewards (Req 3.2).
    $cityHasFirstGet = $false
    $zeroRewardVenues = @()

    foreach ($node in $seedNodes) {
        $label = $node.name
        if ([string]::IsNullOrEmpty($label)) { $label = $node.id }

        # isActive: the public list only returns active nodes, so an absent field
        # reads as "active (implied)" (mirrors Task 2.2). An explicit value is shown as-is.
        $activeText = "active (implied)"
        if ($node.PSObject.Properties.Name -contains "isActive") {
            $activeText = "isActive=$([bool]$node.isActive)"
        }

        # has-coords: lat & lng present and inside the JHB bounding box
        # (lat -26.5..-25.9, lng 27.7..28.4), matching Task 2.2.
        $lat = $node.lat
        $lng = $node.lng
        $hasCoords = ($null -ne $lat) -and ($null -ne $lng) -and `
            ($lat -ge -26.5) -and ($lat -le -25.9) -and ($lng -ge 27.7) -and ($lng -le 28.4)

        # Live rewards for this node. A failed read is surfaced as a per-node WARN
        # (Req 3.1 wants the count visible), never silently treated as zero.
        $liveCount = $null
        $hasFirstGet = $false
        $rewardsReadOk = $true
        try {
            $rewardsResponse = Invoke-RestMethod -Uri "https://api.areacode.co.za/v1/nodes/$($node.id)/rewards"
            $items = @()
            if ($null -ne $rewardsResponse -and $rewardsResponse.PSObject.Properties.Name -contains "items") {
                $items = @($rewardsResponse.items)
            }
            $liveCount = $items.Count
            foreach ($item in $items) {
                if ($item.PSObject.Properties.Name -contains "isFirstGet" -and [bool]$item.isFirstGet) {
                    $hasFirstGet = $true
                }
            }
        }
        catch {
            $rewardsReadOk = $false
        }

        if ($hasFirstGet) { $cityHasFirstGet = $true }

        $coordsText = "no"
        if ($hasCoords) { $coordsText = "yes" }
        $firstGetText = "no"
        if ($hasFirstGet) { $firstGetText = "yes" }

        # Informational per-node line (Write-Host, ungraded). Graded signals below.
        if ($rewardsReadOk) {
            if ($liveCount -eq 0) { $zeroRewardVenues += $label }
            $info = "  - $label | $activeText | has-coords=$coordsText | live rewards=$liveCount | First-Get=$firstGetText"
            Write-Host $info -ForegroundColor Gray
        }
        else {
            $info = "  - $label | $activeText | has-coords=$coordsText | live rewards=UNKNOWN (read failed) | First-Get=$firstGetText"
            Write-Host $info -ForegroundColor Gray
            Write-Check -Status "WARN" -Name "Rewards read $label" -Detail "GET /v1/nodes/$($node.id)/rewards failed; live reward count not verified"
        }
    }

    # Req 3.3: the casual-customer First-Get path (rules/product.md) requires at
    # least one venue in the city to carry a First-Get reward. Zero is a FAIL.
    if ($cityHasFirstGet) {
        Write-Check -Status "PASS" -Name "First-Get present" -Detail "at least one Johannesburg venue has a First-Get reward"
    }
    else {
        Write-Check -Status "FAIL" -Name "First-Get present" -Detail "no venue in Johannesburg has a First-Get reward (casual-customer path depends on it)"
    }

    # Req 3.2: any venue with zero live rewards is a WARN, named. (The
    # exactly-5-nodes warning already lives in Task 2.2 and is not repeated here.)
    if ($zeroRewardVenues.Count -gt 0) {
        $zeroDetail = "$($zeroRewardVenues.Count) venue(s) with zero live rewards: " + ($zeroRewardVenues -join "; ")
        Write-Check -Status "WARN" -Name "Venues with live rewards" -Detail $zeroDetail
    }
    else {
        Write-Check -Status "PASS" -Name "Venues with live rewards" -Detail "every venue has >= 1 live reward"
    }
}
catch {
    Write-Check -Status "FAIL" -Name "Seed-data readiness" -Detail "nodes read failed: $($_.Exception.Message)"
}

Write-Host ""

# ── Manual gates footer (Task 5) ─────────────────────────────────────────────
# Always print the four §1 launch-day blockers as [MANUAL] so a green run is
# never misread as launch approval.
Write-Host "Manual gates (not verifiable by script)" -ForegroundColor Yellow
# The four §1 launch-day blockers. MANUAL never changes the exit code, so a
# green script run still surfaces the human gates a launch cannot skip.
Write-Check -Status "MANUAL" -Name "§1.1 First QR scan on a real staff phone" -Detail "staff sees redemption preview, confirms, sees Redeemed"
Write-Check -Status "MANUAL" -Name "§1.2 First live customer signup from the venue" -Detail "Google OAuth or email; new user lands on the map"
Write-Check -Status "MANUAL" -Name "§1.3 Yoco test payment upgrades venue to paid" -Detail "test-card webhook flips the venue from trial to paid within 60s"
Write-Check -Status "MANUAL" -Name "§1.4 Map loads on a 2019 Android on mobile data" -Detail "shows the map and at least one node within 10s"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
if ($script:failures -gt 0) {
    Write-Host "  Result: FAIL ($script:failures failing check(s))" -ForegroundColor Red
    Write-Host "==========================================" -ForegroundColor Cyan
    exit 1
}

Write-Host "  Result: PASS (no failing checks)" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
exit 0
