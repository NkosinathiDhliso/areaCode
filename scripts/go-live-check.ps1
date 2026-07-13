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
    [string]$Region = "us-east-1",
    # Sha_Parity + authenticated WebSocket gate (Deployment Parity R7.3). A
    # fresh JWT (dev-issued or founder-supplied) for the authenticated $connect
    # probe. Passed to $connect exactly as the frontend passes it: the `token`
    # query param (packages/shared/lib/websocket.ts -> backend/src/lambdas/
    # websocket.ts). When empty the authenticated probe is SKIPPED (reported
    # WARN, never PASS); the unauthenticated handshake alone never gates.
    [string]$WsToken = ""
)

$ErrorActionPreference = "Stop"

# PowerShell 5.1 defaults to TLS 1.0; force TLS 1.2 before any HTTPS call so
# Invoke-RestMethod / Invoke-WebRequest can reach the prod endpoints.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RootDir = Split-Path $PSScriptRoot -Parent

# Failure counter. Any [FAIL] increments this; the script exits 1 when it is
# greater than zero. WARNs and MANUAL lines never change the exit code.
$script:failures = 0

# Sha_Parity state (Deployment Parity R7.2). The API build sha from GET /health
# (set in the §2.1 block) and the latest SUCCEED Amplify master build sha
# (captured in the §3.3 build-parity loop). Compared in the Sha_Parity check.
$script:apiCommit = $null
$script:amplifyMasterSha = $null
$script:amplifyMasterShaSource = $null

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
    # Capture the build sha (Deployment Parity R7.1) for the Sha_Parity check in
    # the Amplify parity section below. Null/empty when the deployed artifact
    # predates the /health `commit` field (itself a parity failure).
    $script:apiCommit = $health.commit
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

            # Fetch a few jobs, not just one: a manually triggered RELEASE job
            # records the literal string "HEAD" as its commitId (not a sha), so
            # the sha-based checks below need the newest job that carries a
            # real commit id.
            $jobsArgs = @(
                "amplify", "list-jobs",
                "--app-id", $app.appId,
                "--branch-name", $branch,
                "--max-items", "5",
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

            # Sha work uses the newest SUCCEED job whose commitId is a real hex
            # sha. A manually triggered RELEASE job records the literal "HEAD"
            # (and rebuilds the branch head), so it gates status above but can
            # never anchor a sha comparison.
            $commitId = $null
            foreach ($job in $jobs) {
                if ($job.status -eq "SUCCEED" -and $job.commitId -match '^[0-9a-fA-F]{7,40}$') {
                    $commitId = $job.commitId
                    break
                }
            }
            $shortSha = "unknown"
            if (-not [string]::IsNullOrEmpty($commitId)) {
                $shortSha = $commitId.Substring(0, [Math]::Min(7, $commitId.Length))
            }

            # Capture the latest SUCCEED master sha for the Sha_Parity check
            # (Deployment Parity R7.2) - reuse this data rather than re-querying.
            # All four apps build from the same master repo, so any SUCCEED
            # master sha is the master build sha; prefer the web app when found.
            if ($branch -eq "master" -and -not [string]::IsNullOrEmpty($commitId)) {
                $isWebApp = $appName -match "web"
                if ($null -eq $script:amplifyMasterSha -or $isWebApp) {
                    $script:amplifyMasterSha = $commitId
                    $script:amplifyMasterShaSource = "$appName ($branch)"
                }
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

# Sha_Parity (Deployment Parity R7.2): the API's build sha (GET /health
# `.commit`, captured in §2.1) must match the latest SUCCEED Amplify master
# build sha (captured in the §3.3 loop). A deployed prod artifact MUST carry a
# real sha: a 'dev' or empty commit is a FAIL (the build-sha embed at
# build:lambda time did not take, or a dev artifact reached prod). A genuine
# mismatch (backend behind the pushed frontends, the July-2026 class) is a FAIL
# printing both shas. Cannot-verify (no AWS master sha, or /health unreachable)
# is a WARN. Full-vs-short shas compare by prefix (git HEAD is full 40 chars;
# an Amplify commitId may be full or short).
$healthCommit = $script:apiCommit
if ([string]::IsNullOrEmpty($healthCommit) -or $healthCommit -eq "dev") {
    $observed = "commit=$healthCommit"
    if ([string]::IsNullOrEmpty($healthCommit)) { $observed = "commit=(absent)" }
    $detail = "$observed (expected a real git sha; a prod artifact must carry AREA_CODE_BUILD_SHA)"
    Write-Check -Status "FAIL" -Name "Sha_Parity" -Detail $detail
}
elseif ([string]::IsNullOrEmpty($script:amplifyMasterSha)) {
    $shortHealth = $healthCommit.Substring(0, [Math]::Min(7, $healthCommit.Length))
    $detail = "API commit=$shortHealth; no Amplify master SUCCEED sha available to compare (AWS unavailable or no successful build); not verified"
    Write-Check -Status "WARN" -Name "Sha_Parity" -Detail $detail
}
else {
    $a = $healthCommit.ToLower()
    $b = $script:amplifyMasterSha.ToLower()
    $shortHealth = $a.Substring(0, [Math]::Min(7, $a.Length))
    $shortAmplify = $b.Substring(0, [Math]::Min(7, $b.Length))
    $match = $a.StartsWith($b) -or $b.StartsWith($a)
    if ($match) {
        $detail = "API commit=$shortHealth matches Amplify master $shortAmplify ($script:amplifyMasterShaSource)"
        Write-Check -Status "PASS" -Name "Sha_Parity" -Detail $detail
    }
    else {
        $detail = "API commit=$shortHealth != Amplify master $shortAmplify ($script:amplifyMasterShaSource); backend is out of parity with the deployed frontends"
        Write-Check -Status "FAIL" -Name "Sha_Parity" -Detail $detail
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

# 9.1 WebSocket reachability (INFORMATIONAL ONLY - Deployment Parity R7.3):
# open a read-only handshake to the prod WebSocket API Gateway URL and report
# whether it reaches State=Open, then close immediately. The $connect route has
# no authorizer, so an unauthenticated handshake opening proves only that the
# endpoint is reachable - NOT that token verification works (the July-2026 502s
# were a $connect that opened anonymously but 502'd on a real token because the
# WS Lambda had no Cognito env). Per R7.3 this probe no longer counts as a
# WebSocket PASS: every outcome here is a WARN. The authenticated probe below
# (via -WsToken) is the real WebSocket gate. The URL is resolved WITHOUT
# hardcoding: AREA_CODE_WEBSOCKET_URL env var, then VITE_WEBSOCKET_URL (the
# frontend var), then the prod Terraform output `websocket_api_endpoint`.

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
            $detail = "handshake opened (State=Open) at $wsUrl (reachability only; the authenticated probe via -WsToken is the WebSocket gate)"
            Write-Check -Status "WARN" -Name "WebSocket reachability" -Detail $detail

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
            $detail = "connection state=$($ws.State) (expected Open) at $wsUrl (reachability only; the authenticated probe via -WsToken is the WebSocket gate)"
            Write-Check -Status "WARN" -Name "WebSocket reachability" -Detail $detail
        }
    }
    catch {
        $msg = $_.Exception.Message
        if ($null -ne $_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
        $detail = "handshake failed: $msg (reachability only; the authenticated probe via -WsToken is the WebSocket gate)"
        Write-Check -Status "WARN" -Name "WebSocket reachability" -Detail $detail
    }
    finally {
        if ($null -ne $ws) { $ws.Dispose() }
        if ($null -ne $cts) { $cts.Dispose() }
    }
}

# 9.1b Authenticated WebSocket gate (Deployment Parity R7.3): the real
# WebSocket PASS. Opens a $connect handshake carrying a real JWT exactly as the
# frontend does - the `token` query param (packages/shared/lib/websocket.ts
# getWebSocket -> backend/src/lambdas/websocket.ts handleConnect reads
# queryStringParameters['token'] and verifies it via verifyBearerToken). A
# valid token that opens proves the WS Lambda can verify tokens (it has the
# Cognito env, the July-2026 502 root cause). Then it exercises a `joinroom`
# echo: the client maps app-level room:join to the `joinroom` route key
# (colons are illegal in route keys), the handler authorises the room and
# replies with a `room:joined` message on the same socket. city:johannesburg is
# allowed for any connection (isRoomAllowed, shared/socket/rooms.ts), so the
# echo works for any pool's token. PASS requires BOTH open AND the echo.
#
# Without -WsToken the gate is SKIPPED: one WARN line (never PASS), so a green
# run without a token is never mistaken for a verified socket.
if ([string]::IsNullOrEmpty($WsToken)) {
    $detail = "SKIPPED: no -WsToken supplied; pass -WsToken <fresh jwt> to gate the authenticated socket (never counts as PASS)"
    Write-Check -Status "WARN" -Name "WebSocket authenticated probe" -Detail $detail
}
elseif ([string]::IsNullOrEmpty($wsUrl)) {
    $detail = "SKIPPED: -WsToken supplied but WebSocket URL unresolved (set AREA_CODE_WEBSOCKET_URL or VITE_WEBSOCKET_URL, or run from a clone with terraform + prod state)"
    Write-Check -Status "WARN" -Name "WebSocket authenticated probe" -Detail $detail
}
else {
    # Append the token exactly as the client does (?token=...&citySlug=...).
    $sep = "?"
    if ($wsUrl.Contains("?")) { $sep = "&" }
    $authUrl = "$wsUrl$sep" + "token=$WsToken&citySlug=johannesburg"

    $aws = $null
    $acts = $null
    try {
        $aws = New-Object System.Net.WebSockets.ClientWebSocket
        $acts = New-Object System.Threading.CancellationTokenSource
        $acts.CancelAfter(10000)
        $auri = New-Object System.Uri($authUrl)

        # A rejected token (401 at $connect) makes ConnectAsync throw; only a
        # verified token reaches State=Open.
        $aconnect = $aws.ConnectAsync($auri, $acts.Token)
        $aconnect.Wait()

        if ($aws.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
            $detail = "authenticated handshake did not open (state=$($aws.State)); token rejected or endpoint down"
            Write-Check -Status "FAIL" -Name "WebSocket authenticated probe" -Detail $detail
        }
        else {
            # Send a joinroom for the public city room and await the echo.
            $joinMsg = '{"action":"joinroom","payload":{"room":"city:johannesburg"}}'
            $sendBytes = [System.Text.Encoding]::UTF8.GetBytes($joinMsg)
            $sendSegment = New-Object System.ArraySegment[byte] -ArgumentList (, $sendBytes)
            $sendTask = $aws.SendAsync($sendSegment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $acts.Token)
            $sendTask.Wait()

            # Receive the reply (bounded by the same 10s token). The handler
            # replies with {"type":"room:joined","payload":{"room":...}}.
            $recvBytes = New-Object byte[] 8192
            $recvSegment = New-Object System.ArraySegment[byte] -ArgumentList (, $recvBytes)
            $recvTask = $aws.ReceiveAsync($recvSegment, $acts.Token)
            $recvTask.Wait()
            $recvResult = $recvTask.Result
            $replyText = [System.Text.Encoding]::UTF8.GetString($recvBytes, 0, $recvResult.Count)

            $echoOk = $false
            try {
                $reply = $replyText | ConvertFrom-Json
                if ($null -ne $reply -and $reply.type -eq "room:joined") { $echoOk = $true }
            }
            catch {
                $echoOk = $false
            }

            if ($echoOk) {
                $detail = "authenticated handshake opened (State=Open) and joinroom echoed room:joined at $wsUrl"
                Write-Check -Status "PASS" -Name "WebSocket authenticated probe" -Detail $detail
            }
            else {
                $snippet = $replyText
                if ($snippet.Length -gt 80) { $snippet = $snippet.Substring(0, 80) }
                $detail = "handshake opened but no room:joined echo (got: $snippet); joinroom path not working"
                Write-Check -Status "FAIL" -Name "WebSocket authenticated probe" -Detail $detail
            }

            $acloseCts = New-Object System.Threading.CancellationTokenSource
            $acloseCts.CancelAfter(5000)
            try {
                $acloseTask = $aws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "go-live-check", $acloseCts.Token)
                $acloseTask.Wait()
            }
            catch {
                # A close-handshake hiccup is irrelevant to the gate; ignore.
            }
            finally {
                $acloseCts.Dispose()
            }
        }
    }
    catch {
        $msg = $_.Exception.Message
        if ($null -ne $_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
        $detail = "authenticated handshake failed: $msg (token rejected at `$connect, or endpoint unreachable/timed out)"
        Write-Check -Status "FAIL" -Name "WebSocket authenticated probe" -Detail $detail
    }
    finally {
        if ($null -ne $aws) { $aws.Dispose() }
        if ($null -ne $acts) { $acts.Dispose() }
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

# 9.2b Pool_Parity gate (cognito-email-pool-cutover R6.1/R6.2). Read the four
# Cognito pool IDs from the DEPLOYED prod API Lambda env, then describe each
# pool and FAIL unless UsernameAttributes = ["email"] on all four.
#
# Authority: the pool ids come from the running API Lambda's environment (the
# same source the 2026-07-12 audit used), NOT from a local env var or a
# terraform output. That is deliberate and is the whole point of the gate: it
# catches drift between what the deployed backend actually verifies tokens
# against and the email/Google-only auth architecture (the phone-username relic
# that blocked business/staff email signup). Resolving from local state instead
# would only re-check the source of truth against itself and miss the drift.
# This is why it does not reuse the §9.2 Resolve-PoolId helper: same describe
# call, deliberately different (deployed-Lambda) authority.
#
# Configuration only, never user data (R6.2): this reads the pool-id env keys
# from the Lambda config and each pool's UsernameAttributes from
# describe-user-pool. It never calls list-users, never counts users, and never
# reads anything about an individual.
Write-Host "Pool parity (auth architecture drift gate)" -ForegroundColor Yellow

$apiFunctionName = "area-code-prod-api"
# The four API Lambda env keys that carry the pool ids (tech.md). Each maps to
# one auth context; this is the report order.
$poolParityKeys = @(
    [pscustomobject]@{ Context = "consumer"; EnvKey = "AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID" },
    [pscustomobject]@{ Context = "business"; EnvKey = "AREA_CODE_COGNITO_BUSINESS_USER_POOL_ID" },
    [pscustomobject]@{ Context = "staff"; EnvKey = "AREA_CODE_COGNITO_STAFF_USER_POOL_ID" },
    [pscustomobject]@{ Context = "admin"; EnvKey = "AREA_CODE_COGNITO_ADMIN_USER_POOL_ID" }
)

if (-not $script:awsAvailable) {
    Write-Check -Status "WARN" -Name "Pool_Parity" -Detail "AWS CLI unavailable; not checked"
}
else {
    # Read the deployed API Lambda env once. A read failure (missing function,
    # permission, or credentials) is a WARN (cannot verify), matching the other
    # AWS state checks; it never silently passes.
    $apiCfg = Invoke-AwsJson -AwsArgs @(
        "lambda", "get-function-configuration",
        "--function-name", $apiFunctionName,
        "--region", $Region
    )
    if ($null -eq $apiCfg) {
        $detail = "could not read $apiFunctionName configuration (missing function, permission, or credentials); not checked"
        Write-Check -Status "WARN" -Name "Pool_Parity" -Detail $detail
    }
    else {
        # Environment / Environment.Variables are absent when the function has no
        # env vars at all; treat that as every pool binding missing (FAIL below),
        # not a read failure.
        $apiVars = $null
        if ($null -ne $apiCfg.Environment -and $null -ne $apiCfg.Environment.Variables) {
            $apiVars = $apiCfg.Environment.Variables
        }

        foreach ($poolEnv in $poolParityKeys) {
            $poolContext = $poolEnv.Context
            $envKey = $poolEnv.EnvKey
            $label = "Pool_Parity $poolContext"

            # Pool id from the deployed Lambda env. Absent/empty is a FAIL: the
            # running backend has no pool binding for this context, itself a
            # deploy defect (no masking default, per no-fallbacks-no-legacy.md).
            $poolId = $null
            if ($null -ne $apiVars -and $apiVars.PSObject.Properties.Name -contains $envKey) {
                $poolId = $apiVars.$envKey
            }
            if ([string]::IsNullOrEmpty($poolId)) {
                $detail = "$envKey not set on $apiFunctionName (deployed backend has no $poolContext pool binding)"
                Write-Check -Status "FAIL" -Name $label -Detail $detail
                continue
            }

            # describe-user-pool: read UsernameAttributes only. A read failure
            # (permission/credentials) is a WARN; a resolved pool whose
            # UsernameAttributes is not exactly ["email"] is a FAIL.
            $poolResult = Invoke-AwsJson -AwsArgs @("cognito-idp", "describe-user-pool", "--user-pool-id", $poolId, "--region", $Region)
            if ($null -eq $poolResult -or $null -eq $poolResult.UserPool) {
                Write-Check -Status "WARN" -Name $label -Detail "could not describe pool $poolId (missing permission or credentials); not checked"
                continue
            }

            # Guard the null case explicitly: @($null) is a 1-element array in
            # PowerShell, so an absent UsernameAttributes must read as empty, not
            # as a single null entry.
            $usernameAttrs = @()
            if ($null -ne $poolResult.UserPool.UsernameAttributes) {
                $usernameAttrs = @($poolResult.UserPool.UsernameAttributes)
            }
            $attrText = ($usernameAttrs -join ", ")
            if ([string]::IsNullOrEmpty($attrText)) { $attrText = "(none)" }

            $isEmailOnly = ($usernameAttrs.Count -eq 1) -and ($usernameAttrs[0] -eq "email")
            if ($isEmailOnly) {
                Write-Check -Status "PASS" -Name $label -Detail "UsernameAttributes=[email] (pool $poolId)"
            }
            else {
                $detail = "UsernameAttributes=[$attrText] (expected [email]); pool $poolId contradicts the email/Google-only auth architecture"
                Write-Check -Status "FAIL" -Name $label -Detail $detail
            }
        }
    }
}

Write-Host ""

# Get-FunctionLastModifiedMs returns the Lambda's last-deploy time as epoch ms,
# or $null when unresolved (CLI absent, no permission, missing function, or an
# unparseable timestamp). Used to scope the worker error scan to "since the last
# deploy": a worker fixed and redeployed emits its final pre-fix ERROR before
# the deploy, so counting those against the new code is a false FAIL that lingers
# for up to 24h. LastModified advances on ANY code or config update (env var /
# VPC change), which is exactly the shape of the fixes this scan must clear.
function Get-FunctionLastModifiedMs {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LogGroupName
    )

    if (-not $script:awsAvailable) { return $null }

    # Log group /aws/lambda/<fn> -> function name <fn>.
    $prefix = "/aws/lambda/"
    $functionName = $LogGroupName
    if ($LogGroupName.StartsWith($prefix)) {
        $functionName = $LogGroupName.Substring($prefix.Length)
    }

    $cfg = Invoke-AwsJson -AwsArgs @(
        "lambda", "get-function-configuration",
        "--function-name", $functionName,
        "--region", $Region
    )
    if ($null -eq $cfg -or [string]::IsNullOrEmpty($cfg.LastModified)) { return $null }

    # LastModified is ISO-8601 (e.g. 2026-07-05T10:30:00.000+0000). Parse to
    # epoch ms; any parse failure yields $null (deploy time cannot be verified).
    try {
        $dto = [DateTimeOffset]::Parse(
            $cfg.LastModified,
            [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::AssumeUniversal
        )
        return $dto.ToUnixTimeMilliseconds()
    }
    catch {
        return $null
    }
}

# 9.3 Worker error scan: an ERROR filter looped over the worker log groups,
# scoped to the deploy-aware window below. Lambda function names differ from
# some SQS queue names, so the log-group names use the real Lambda names: the
# campaign worker Lambda is `campaign-sender` (queue: campaign-send) and the
# report worker Lambda is
# `report-generator` (queue: report-generation). There is no push-sender worker
# Lambda or push-sender SQS queue: the queue was deleted (report-ready now
# delivers via SES + WebSocket), so no `area-code-prod-push-sender` log group
# exists and none is scanned.
# FAIL when a group returns an ERROR event (print group + first event); PASS
# when clean; WARN when a group is not queryable.
#
# Each worker carries its trigger type. Scheduled (EventBridge) workers fire on
# a fixed tick regardless of input, so a missing log group on one deployed more
# than 7 days ago proves it has never run = FAIL (Req 5.3). SQS-triggered
# workers legitimately stay quiet when no message ever arrives, so a missing
# log group there stays WARN however old the deploy is. Scheduled: presence-
# expiry, pulse-decay, streak-reminder. SQS: reward-evaluator, campaign-sender,
# report-generator (see infra/environments/prod/main.tf eventbridge schedules
# vs SQS event source mappings).
$workerLogGroups = @(
    [pscustomobject]@{ LogGroup = "/aws/lambda/area-code-prod-reward-evaluator"; Scheduled = $false },
    [pscustomobject]@{ LogGroup = "/aws/lambda/area-code-prod-presence-expiry"; Scheduled = $true },
    [pscustomobject]@{ LogGroup = "/aws/lambda/area-code-prod-pulse-decay"; Scheduled = $true },
    [pscustomobject]@{ LogGroup = "/aws/lambda/area-code-prod-campaign-sender"; Scheduled = $false },
    [pscustomobject]@{ LogGroup = "/aws/lambda/area-code-prod-report-generator"; Scheduled = $false },
    [pscustomobject]@{ LogGroup = "/aws/lambda/area-code-prod-streak-reminder"; Scheduled = $true }
)

foreach ($worker in $workerLogGroups) {
    $workerLogGroup = $worker.LogGroup
    if (-not $script:awsAvailable) {
        Write-Check -Status "WARN" -Name "Worker errors $workerLogGroup" -Detail "AWS CLI unavailable; not checked"
        continue
    }

    # Scan window: the last 24h, but never earlier than this worker's last
    # deploy. A fix redeployed 2h ago scans only the last 2h, so a final ERROR
    # from the retired code does not produce a false FAIL against the new code.
    # When the deploy time cannot be read, keep the full 24h window (honest: we
    # cannot prove the code is newer, so we do not narrow the scan).
    $defaultStartMs = [DateTimeOffset]::UtcNow.AddHours(-24).ToUnixTimeMilliseconds()
    $workerStartMs = $defaultStartMs
    $scanWindowText = "last 24h"
    $lastModMs = Get-FunctionLastModifiedMs -LogGroupName $workerLogGroup
    if ($null -ne $lastModMs -and $lastModMs -gt $defaultStartMs) {
        $workerStartMs = $lastModMs
        $deployTime = ([DateTimeOffset]::FromUnixTimeMilliseconds($lastModMs)).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ")
        $scanWindowText = "since deploy $deployTime"
    }
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
        # A non-null $lastModMs means Get-FunctionLastModifiedMs already read the
        # Lambda config, so credentials work and the function exists: the null
        # events result then means the log group genuinely does not exist yet
        # (the worker has never run), not a credentials problem. For a SCHEDULED
        # worker deployed more than 7 days ago that is a real failure (Req 5.3);
        # a recent deploy may just not have hit its first tick, and SQS workers
        # may have had no messages, so both stay WARN. Reuses the deploy-window
        # LastModified read above rather than making a second AWS call.
        $sevenDaysAgoMs = [DateTimeOffset]::UtcNow.AddDays(-7).ToUnixTimeMilliseconds()
        if ($worker.Scheduled -and $null -ne $lastModMs -and $lastModMs -lt $sevenDaysAgoMs) {
            $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            $deployedDaysAgo = [int][Math]::Floor(($nowMs - $lastModMs) / 86400000)
            $detail = "missing log group; scheduled worker last deployed $deployedDaysAgo days ago has never run (expected a log group within 7 days)"
            Write-Check -Status "FAIL" -Name "Worker errors $workerLogGroup" -Detail $detail
        }
        else {
            Write-Check -Status "WARN" -Name "Worker errors $workerLogGroup" -Detail "log group not queryable (missing group or credentials)"
        }
    }
    else {
        $workerEvents = @($workerResult.events)
        if ($workerEvents.Count -eq 0) {
            Write-Check -Status "PASS" -Name "Worker errors $workerLogGroup" -Detail "no ERROR events $scanWindowText"
        }
        else {
            $firstMessage = "$($workerEvents[0].message)".Trim()
            $maxLen = 200
            if ($firstMessage.Length -gt $maxLen) {
                $firstMessage = $firstMessage.Substring(0, $maxLen) + "..."
            }
            $detail = "$($workerEvents.Count) ERROR event(s) $scanWindowText; first: $firstMessage"
            Write-Check -Status "FAIL" -Name "Worker errors $workerLogGroup" -Detail $detail
        }
    }
}

Write-Host ""

# ── Payment configuration (billing-revenue-integrity R1.4 / checklist §10.1) ──
# Assert the Yoco payment secrets are present and non-empty on the prod Lambda
# that reads them. The monolith API Lambda (area-code-prod-api) reads both
# YOCO_WEBHOOK_SECRET and YOCO_PROD_SECRET_KEY; it is the single webhook path
# (the dedicated yoco-webhook Lambda, deleted 2026-07-10, only ever ran the
# infra placeholder and swallowed webhooks with a 200). A secret that is
# absent from the function's environment, or present but empty, is a FAIL (the
# deploy did not inject it, matching defect R1.1). An unresolvable configuration
# (CLI absent, no permission, or missing function) is a WARN (cannot verify),
# consistent with the other AWS state checks. Read-only:
# get-function-configuration is a describe call, never a mutation. Secret VALUES
# are never printed; only presence/absence is reported.
Write-Host "Payment configuration" -ForegroundColor Yellow

# Assert-LambdaSecrets reads one Lambda's configuration once and checks each
# required env var key is present and non-empty. Emits one [PASS]/[FAIL] per
# key, or a single [WARN] when the configuration cannot be read at all. Reuses
# Invoke-AwsJson, Write-Check, $script:awsAvailable, and $Region.
function Assert-LambdaSecrets {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FunctionName,

        [Parameter(Mandatory = $true)]
        [string[]]$RequiredKeys
    )

    if (-not $script:awsAvailable) {
        Write-Check -Status "WARN" -Name "Lambda secrets $FunctionName" -Detail "AWS CLI unavailable; not checked"
        return
    }

    $cfg = Invoke-AwsJson -AwsArgs @(
        "lambda", "get-function-configuration",
        "--function-name", $FunctionName,
        "--region", $Region
    )
    if ($null -eq $cfg) {
        Write-Check -Status "WARN" -Name "Lambda secrets $FunctionName" -Detail "could not read function configuration (missing function, permission, or credentials)"
        return
    }

    # Environment / Environment.Variables are absent when the function has no
    # env vars at all; treat that as every required key missing (FAIL), not a
    # read failure.
    $variables = $null
    if ($null -ne $cfg.Environment -and $null -ne $cfg.Environment.Variables) {
        $variables = $cfg.Environment.Variables
    }

    foreach ($key in $RequiredKeys) {
        $value = $null
        if ($null -ne $variables -and $variables.PSObject.Properties.Name -contains $key) {
            $value = $variables.$key
        }
        # Report presence only. Never echo the secret value.
        if ([string]::IsNullOrEmpty($value)) {
            Write-Check -Status "FAIL" -Name "$FunctionName $key" -Detail "not set or empty (expected a non-empty secret)"
        }
        elseif ($value -match '^(REPLACE_WITH|CHANGEME|PLACEHOLDER|TODO)') {
            # A template placeholder passes the non-empty test but can never
            # verify a real signature: real Yoco webhooks would be rejected and
            # paid upgrades never activate (found live 2026-07-11, the deployed
            # YOCO_WEBHOOK_SECRET was the tfvars template literal).
            Write-Check -Status "FAIL" -Name "$FunctionName $key" -Detail "set to a template placeholder, not a real secret"
        }
        else {
            Write-Check -Status "PASS" -Name "$FunctionName $key" -Detail "set (non-empty)"
        }
    }
}

Assert-LambdaSecrets -FunctionName "area-code-prod-api" -RequiredKeys @("YOCO_WEBHOOK_SECRET", "YOCO_PROD_SECRET_KEY")

# R10.2: Unsigned-POST probe against the live webhook route. POST a harmless
# dummy JSON body to POST /v1/webhooks/yoco with NO valid signature header and
# assert the response is 401 — proving the signature gate is alive and fails
# closed (processYocoWebhook verifies the HMAC before touching any state, so the
# body is rejected before it can change anything). This is the one write-shaped
# probe in an otherwise read-only script; the request is expected to be rejected.
#   401     => PASS (gate alive, fail-closed).
#   2xx     => FAIL (the gate accepted an unsigned request — dead/open).
#   5xx     => FAIL (unexpected error, not a clean rejection).
#   other   => report the observed code; non-401 is a FAIL (R10.2 requires 401).
#   network => FAIL with the exception message.
# Invoke-WebRequest throws on non-2xx under $ErrorActionPreference = Stop, so the
# 401 arrives via the exception; recover the status code from the exception
# Response, matching the portal HEAD pattern above.
$webhookUrl = "https://api.areacode.co.za/v1/webhooks/yoco"
$probeBody = '{"type":"payment.succeeded","id":"go-live-check-probe"}'
try {
    $response = Invoke-WebRequest -Method Post -Uri $webhookUrl -Body $probeBody `
        -ContentType "application/json" -UseBasicParsing
    # A 2xx here means the unsigned request was accepted — the gate is dead/open.
    $statusCode = [int]$response.StatusCode
    $detail = "HTTP $statusCode to unsigned POST (expected 401; gate accepted an unsigned request)"
    Write-Check -Status "FAIL" -Name "Webhook signature gate" -Detail $detail
}
catch {
    $exResponse = $_.Exception.Response
    if ($null -ne $exResponse -and $null -ne $exResponse.StatusCode) {
        $statusCode = [int]$exResponse.StatusCode
        if ($statusCode -eq 401) {
            $detail = "HTTP 401 to unsigned POST (signature gate alive, fail-closed)"
            Write-Check -Status "PASS" -Name "Webhook signature gate" -Detail $detail
        }
        elseif ($statusCode -ge 500) {
            $detail = "HTTP $statusCode to unsigned POST (expected 401; server error, not a clean rejection)"
            Write-Check -Status "FAIL" -Name "Webhook signature gate" -Detail $detail
        }
        else {
            $detail = "HTTP $statusCode to unsigned POST (expected 401)"
            Write-Check -Status "FAIL" -Name "Webhook signature gate" -Detail $detail
        }
    }
    else {
        Write-Check -Status "FAIL" -Name "Webhook signature gate" -Detail "request failed: $($_.Exception.Message) (expected 401)"
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

# ── Closure checks (Deployment Parity R7.4) ─────────────────────────────────
# Run the two static closure scripts as go-live gates: Table_Closure (R4.4,
# scripts/check-table-closure.mjs) and Amplify_Env_Closure (R6.4,
# scripts/check-amplify-env-closure.mjs). Both are static (no AWS/network),
# exit non-zero on a real gap, and print gap detail on stderr. A non-zero exit
# is a FAIL (offending lines echoed); exit 0 is a PASS. node absent is a WARN,
# matching the AWS-CLI-absent pattern used above.
Write-Host "Closure checks" -ForegroundColor Yellow

$script:nodeAvailable = $null -ne (Get-Command node -ErrorAction SilentlyContinue)

# Invoke-ClosureCheck runs one closure script via node and gates on its exit
# code (0 = PASS, non-zero = FAIL). node stderr (where the scripts print gap
# detail) is redirected to a temp file so the offending lines can be echoed on
# a FAIL. This is NOT `2>&1`: stdout and stderr never merge. $ErrorActionPreference
# is dropped to Continue only around the node call, because under Stop a native
# command's first stderr write is promoted to a terminating error (the same
# reason the AWS calls above use 2>$null); it is restored immediately after.
# WARNs when node is missing, the script is absent, or node cannot be launched.
function Invoke-ClosureCheck {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptRelPath,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if (-not $script:nodeAvailable) {
        Write-Check -Status "WARN" -Name $Name -Detail "node not on PATH; closure check not run"
        return
    }

    $scriptPath = Join-Path $RootDir $ScriptRelPath
    if (-not (Test-Path $scriptPath)) {
        Write-Check -Status "WARN" -Name $Name -Detail "$ScriptRelPath not found; closure check not run"
        return
    }

    $tmpErr = [System.IO.Path]::GetTempFileName()
    $code = $null
    $prevEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & node $scriptPath 2>$tmpErr | Out-Null
        $code = $LASTEXITCODE
    }
    catch {
        $ErrorActionPreference = $prevEap
        if (Test-Path $tmpErr) { Remove-Item $tmpErr -ErrorAction SilentlyContinue }
        Write-Check -Status "WARN" -Name $Name -Detail "could not run node $ScriptRelPath`: $($_.Exception.Message)"
        return
    }
    finally {
        $ErrorActionPreference = $prevEap
    }

    $stderrText = ""
    if (Test-Path $tmpErr) {
        $raw = Get-Content $tmpErr -Raw
        if ($null -ne $raw) { $stderrText = $raw }
        Remove-Item $tmpErr -ErrorAction SilentlyContinue
    }

    if ($code -eq 0) {
        Write-Check -Status "PASS" -Name $Name -Detail "no closure gaps (exit 0)"
        return
    }

    # Non-zero: collect the offending lines. The scripts print `x`-prefixed gap
    # lines plus a FAIL summary on stderr; drop PowerShell error-record noise
    # (the `+ CategoryInfo`/`+ FullyQualifiedErrorId` metadata and the leading
    # `node.exe : ` wrapper the console-error records pick up).
    $offending = @()
    foreach ($line in ($stderrText -split "`n")) {
        $t = $line.Trim()
        if ($t -eq "") { continue }
        if ($t.StartsWith("+")) { continue }
        if ($t -match "^\S+\.exe\s*:\s*") { $t = ($t -replace "^\S+\.exe\s*:\s*", "").Trim() }
        if ($t -eq "") { continue }
        if ($t -like "*FAIL*" -or $t -like "x *") { $offending += $t }
    }
    if ($offending.Count -eq 0 -and $stderrText.Trim() -ne "") {
        $offending = @(($stderrText.Trim() -split "`n" | Select-Object -First 1).Trim())
    }

    $detail = "exit $code"
    if ($offending.Count -gt 0) {
        $detail = "exit $code`: " + (($offending | Select-Object -First 6) -join " | ")
    }
    Write-Check -Status "FAIL" -Name $Name -Detail $detail
}

Invoke-ClosureCheck -ScriptRelPath "scripts/check-table-closure.mjs" -Name "Table_Closure"
Invoke-ClosureCheck -ScriptRelPath "scripts/check-amplify-env-closure.mjs" -Name "Amplify_Env_Closure"

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
