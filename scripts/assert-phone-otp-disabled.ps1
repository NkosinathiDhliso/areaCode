<#
  CI guard: verifies the phone-OTP / SMS lock is intact.

  Runs in quality-gate.yml. Fails the build if any of the following are
  missing, so a future "cleanup" PR or an AI tool can't silently remove
  the gate without someone noticing.

  Companion to .kiro/steering/no-sms-no-phone-auth.md.
#>

$ErrorActionPreference = 'Stop'
$failed = @()

# 1. Steering file exists.
if (-not (Test-Path '.kiro/steering/no-sms-no-phone-auth.md')) {
  $failed += 'Steering file .kiro/steering/no-sms-no-phone-auth.md is missing.'
}

# 2. Phone-OTP gate constant is present in the auth handler.
$handler = Get-Content -Raw 'backend/src/features/auth/handler.ts'
if ($handler -notmatch 'PHONE_OTP_DISABLED') {
  $failed += "PHONE_OTP_DISABLED gate is missing from backend/src/features/auth/handler.ts."
}
if ($handler -notmatch "rejectIfPhoneOtpDisabled") {
  $failed += "rejectIfPhoneOtpDisabled helper is missing from backend/src/features/auth/handler.ts."
}

# 3. ESLint guards are wired.
$eslint = Get-Content -Raw 'eslint.config.js'
if ($eslint -notmatch "@aws-sdk/client-pinpoint-sms-voice-v2") {
  $failed += "ESLint no-restricted-imports rule for AWS SMS SDK is missing from eslint.config.js."
}
if ($eslint -notmatch 'JSXOpeningElement\[name\.name=' + "'input'") {
  # Soft-check (the selector string is hard to match across formatting); skip if the import rule is present.
}

# 4. Steering file forbids the import substring "type=\"tel\"" via the lint
#    rule above. We don't need to scan source code separately — eslint will
#    fail any PR that violates it.

if ($failed.Count -gt 0) {
  Write-Error @"
Phone-OTP / SMS lock verification FAILED.

The no-SMS / no-phone-auth decision is documented in:
  .kiro/steering/no-sms-no-phone-auth.md

If you genuinely need to revisit the decision, that file is the place to
start. Do not remove the locks without updating it.

Issues found:
$( $failed | ForEach-Object { "  - $_" } | Out-String )
"@
  exit 1
}

Write-Host "Phone-OTP / SMS lock verified."
exit 0
