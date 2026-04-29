# Update Amplify Frontend API URLs to Serverless Backend
param(
    [string]$Region = "us-east-1",
    [string]$NewApiUrl = "https://iyj02gvt12.execute-api.us-east-1.amazonaws.com"
)

$ErrorActionPreference = "Stop"

# Your 4 Amplify Apps
$AmplifyApps = @(
    @{ Name = "web"; AppId = "d3pm78r41ma6w6"; Branches = @("main", "production") },
    @{ Name = "admin"; AppId = "d1ay6jict0ql9w"; Branches = @("main") },
    @{ Name = "business"; AppId = "dbp54yxhyjvk0"; Branches = @("main") },
    @{ Name = "staff"; AppId = "d166bb81tg4k61"; Branches = @("main") }
)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Updating Amplify API URLs" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "New API Endpoint: $NewApiUrl" -ForegroundColor Yellow
Write-Host ""

foreach ($app in $AmplifyApps) {
    Write-Host "Updating $($app.Name) app (ID: $($app.AppId))..." -ForegroundColor Green
    
    foreach ($branch in $app.Branches) {
        Write-Host "  Branch: $branch" -ForegroundColor Gray
        
        # Get current environment variables
        $envVars = aws amplify get-branch `
            --app-id $app.AppId `
            --branch-name $branch `
            --region $Region `
            --query 'branch.environmentVariables' `
            --output json 2>$null | ConvertFrom-Json
        
        # Create new environment variables object
        $newEnvVars = @{}
        
        # Copy existing vars except the old API URL
        if ($envVars) {
            $envVars.PSObject.Properties | ForEach-Object {
                if ($_.Name -notin @('VITE_API_URL', 'REACT_APP_API_URL', 'API_URL')) {
                    $newEnvVars[$_.Name] = $_.Value
                }
            }
        }
        
        # Add the new API URL (used for both REST API and WebSocket)
        $newEnvVars['VITE_API_URL'] = $NewApiUrl
        $newEnvVars['VITE_SOCKET_URL'] = $NewApiUrl
        
        # Convert to JSON for AWS CLI
        $envVarsJson = $newEnvVars | ConvertTo-Json -Compress
        
        # Update the branch with new environment variables
        aws amplify update-branch `
            --app-id $app.AppId `
            --branch-name $branch `
            --environment-variables "VITE_API_URL=$NewApiUrl,VITE_SOCKET_URL=$NewApiUrl" `
            --region $Region
        
        # Trigger a new build
        aws amplify start-job `
            --app-id $app.AppId `
            --branch-name $branch `
            --job-type RELEASE `
            --region $Region
        
        Write-Host "    ✓ Updated and triggered new build" -ForegroundColor Green
    }
    Write-Host ""
}

Write-Host "==========================================" -ForegroundColor Green
Write-Host "  All Amplify Apps Updated!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Wait 2-3 minutes for builds to complete" -ForegroundColor Gray
Write-Host "2. Test the apps - they should now connect to the new API" -ForegroundColor Gray
Write-Host ""
Write-Host "Monitor builds at: https://us-east-1.console.aws.amazon.com/amplify/apps" -ForegroundColor Cyan
