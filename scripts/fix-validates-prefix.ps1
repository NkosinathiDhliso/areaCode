$path = '.kiro\specs\live-vibe-on-map\design.md'
$c = Get-Content -Raw $path
# Replace ", R<digit>" with ", <digit>" in Validates lines.
# Process line by line so we don't rewrite the rollout narrative below.
$lines = $c -split "`r?`n"
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\*\*Validates: Requirements ') {
        $lines[$i] = $lines[$i] -replace ', R(\d)', ', $1'
    }
}
$out = $lines -join "`r`n"
$out = $out -replace '\*\*Validates: Requirements 7, 10\.6\.\*\*', '**Validates: Requirements 7.1, 10.6.**'
Set-Content -NoNewline -Path $path -Value $out
