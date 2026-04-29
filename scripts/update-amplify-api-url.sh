#!/bin/bash
# Update Amplify Frontend API URLs to Serverless Backend

set -e

REGION="us-east-1"
NEW_API_URL="https://iyj02gvt12.execute-api.us-east-1.amazonaws.com"

echo "=========================================="
echo "  Updating Amplify API URLs"
echo "=========================================="
echo ""
echo "New API Endpoint: $NEW_API_URL"
echo ""

# Your 4 Amplify Apps
update_amplify_app() {
    local name=$1
    local app_id=$2
    shift 2
    local branches=("$@")
    
    echo "Updating $name app (ID: $app_id)..."
    
    for branch in "${branches[@]}"; do
        echo "  Branch: $branch"
        
        # Update the branch with new environment variables
        aws amplify update-branch \
            --app-id "$app_id" \
            --branch-name "$branch" \
            --environment-variables "VITE_API_URL=$NEW_API_URL,VITE_SOCKET_URL=$NEW_API_URL" \
            --region "$REGION"
        
        # Trigger a new build
        aws amplify start-job \
            --app-id "$app_id" \
            --branch-name "$branch" \
            --job-type RELEASE \
            --region "$REGION"
        
        echo "    ✓ Updated and triggered new build"
    done
    echo ""
}

# Update each app
update_amplify_app "web" "d3pm78r41ma6w6" "main" "production"
update_amplify_app "admin" "d1ay6jict0ql9w" "main"
update_amplify_app "business" "dbp54yxhyjvk0" "main"
update_amplify_app "staff" "d166bb81tg4k61" "main"

echo "=========================================="
echo "  All Amplify Apps Updated!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Wait 2-3 minutes for builds to complete"
echo "2. Test the apps - they should now connect to the new API"
echo ""
echo "Monitor builds at: https://us-east-1.console.aws.amazon.com/amplify/apps"
