# Cognito Custom Domain Cutover — `auth.areacode.co.za`

This runbook turns the consumer pool's Hosted UI domain from
`area-code-prod-consumer.auth.us-east-1.amazoncognito.com` into
`auth.areacode.co.za`. The user no longer sees AWS branding in the URL
bar during Google sign-in.

The cert request and DNS validation have already been done — see the
ACM cert ARN in §State below.

## State at runbook creation

- ACM cert: `arn:aws:acm:us-east-1:562691664641:certificate/97a216e7-a059-48e1-b77c-164163389c45`
- Route 53 zone: `Z0263725FVT0QYF18KLO` (areacode.co.za)
- Consumer pool: `us-east-1_nnSoej4pn`
- Consumer client: `5pn5l49sk08bqdavsom3eusf0b`
- Existing Hosted UI domain: `area-code-prod-consumer` (Cognito-hosted)
- Cognito only allows ONE custom domain per pool. We're swapping, not adding.

## Why this needs care

The existing Cognito-hosted domain will keep working until we delete it.
The risk is: if we add the custom domain but don't update the Google
OAuth client's "Authorized redirect URIs", every Google sign-in fails.
Sequence below avoids that.

## Cutover steps

### 1. Confirm the ACM cert is issued

```bash
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:562691664641:certificate/97a216e7-a059-48e1-b77c-164163389c45 \
  --region us-east-1 \
  --query 'Certificate.Status' --output text
```

Must say `ISSUED`. If it says `PENDING_VALIDATION` after an hour, check
that the validation CNAME is in Route 53 and re-request if needed.

### 2. Update Google Cloud OAuth client BEFORE touching Cognito

Go to console.cloud.google.com → APIs & Services → Credentials → OAuth
2.0 Client IDs → click the consumer client (it's the one whose ID ends
`r5h0dl1g4no2m81u9em0srucu30e41lf`).

Under "Authorized redirect URIs", add:

```
https://auth.areacode.co.za/oauth2/idpresponse
```

Keep the existing `area-code-prod-consumer.auth.us-east-1.amazoncognito.com/oauth2/idpresponse` entry. We'll remove it later.

Click Save. Google propagates within a minute.

### 3. Update the consumer app client's redirect URLs

```bash
aws cognito-idp update-user-pool-client \
  --user-pool-id us-east-1_nnSoej4pn \
  --client-id 5pn5l49sk08bqdavsom3eusf0b \
  --supported-identity-providers COGNITO Google \
  --callback-urls \
    "areacode://auth/callback" \
    "http://localhost:5173/auth/callback" \
    "https://areacode.co.za/auth/callback" \
    "https://master.d3pm78r41ma6w6.amplifyapp.com/auth/callback" \
    "https://www.areacode.co.za/auth/callback" \
  --logout-urls \
    "http://localhost:5173/" \
    "https://areacode.co.za/" \
    "https://master.d3pm78r41ma6w6.amplifyapp.com/" \
    "https://www.areacode.co.za/" \
  --allowed-o-auth-flows code \
  --allowed-o-auth-scopes openid email profile aws.cognito.signin.user.admin \
  --allowed-o-auth-flows-user-pool-client
```

The app client's redirect URIs are domain-agnostic — they're our app's
URL, not the Cognito Hosted UI URL. So this command is mostly a no-op,
but include it to make sure the existing flags stay intact when we
modify the pool below.

### 4. Add the custom domain to the pool

```bash
aws cognito-idp create-user-pool-domain \
  --user-pool-id us-east-1_nnSoej4pn \
  --domain auth.areacode.co.za \
  --custom-domain-config CertificateArn=arn:aws:acm:us-east-1:562691664641:certificate/97a216e7-a059-48e1-b77c-164163389c45
```

Returns a CloudFront distribution domain like `dXXXXXXXX.cloudfront.net`.
Capture it.

### 5. Add Route 53 alias to the CloudFront distribution

```bash
DIST_DOMAIN=<the dXXXXXXXX.cloudfront.net from step 4>
cat > /tmp/auth-alias.json <<EOF
{
  "Comment": "Cognito custom domain alias",
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "auth.areacode.co.za.",
      "Type": "A",
      "AliasTarget": {
        "HostedZoneId": "Z2FDTNDATAQYW2",
        "DNSName": "$DIST_DOMAIN",
        "EvaluateTargetHealth": false
      }
    }
  }]
}
EOF
aws route53 change-resource-record-sets \
  --hosted-zone-id Z0263725FVT0QYF18KLO \
  --change-batch file:///tmp/auth-alias.json
```

The hard-coded `Z2FDTNDATAQYW2` is CloudFront's global hosted zone ID —
same for every distribution in every region. Don't change it.

### 6. Wait for DNS + Cognito to converge (5-15 min)

```bash
# Test resolution
nslookup auth.areacode.co.za

# Test the OAuth endpoint
curl -I https://auth.areacode.co.za/oauth2/authorize?client_id=5pn5l49sk08bqdavsom3eusf0b
```

Should return 200 or 302 once ready. If it returns 5xx for more than 15
minutes, something's wrong — check ACM cert status and the alias record.

### 7. Update Amplify env var

```bash
aws amplify update-app \
  --app-id <consumer-amplify-app-id> \
  --environment-variables \
    VITE_COGNITO_HOSTED_UI_DOMAIN=auth.areacode.co.za \
    [other vars]
```

Use the existing `scripts/update-all-amplify-apps.ps1` if it covers
this — easier than constructing the full env var list manually.

### 8. Trigger an Amplify rebuild

```bash
aws amplify start-job \
  --app-id <consumer-amplify-app-id> \
  --branch-name master \
  --job-type RELEASE
```

Wait for the build to finish.

### 9. Smoke test on the live consumer site

- Open `https://areacode.co.za` in an incognito window
- Click "Continue with Google"
- The URL bar should briefly show `https://auth.areacode.co.za/oauth2/authorize?...`
- After Google consent, it should return cleanly to `https://areacode.co.za/auth/callback`

If anything fails, the existing Cognito-hosted domain still works.
Roll back by setting the Amplify env var back to the old domain and
re-deploying.

### 10. Once stable, remove the old Cognito-hosted domain

```bash
aws cognito-idp delete-user-pool-domain \
  --user-pool-id us-east-1_nnSoej4pn \
  --domain area-code-prod-consumer
```

And from Google Cloud, remove the old `*.auth.us-east-1.amazoncognito.com`
redirect URI from the OAuth client.

## Rollback

The custom domain can be deleted at any time via:

```bash
aws cognito-idp delete-user-pool-domain \
  --user-pool-id us-east-1_nnSoej4pn \
  --domain auth.areacode.co.za
```

Then revert the Amplify env var. The original Cognito-hosted domain
keeps working as long as it hasn't been deleted.

## Why I didn't run steps 4-10 from the AI session

Steps 4 and 5 take effect on a live OAuth flow. Steps 7 and 8 require
knowing the Amplify app ID for the consumer site, which needs lookup in
the AWS console. Step 2 is mandatory and not AWS — it's Google Cloud
Console only.

The combination meant I'd be making changes that could break Google
sign-in for real users between step 4 and step 2 if I'd done step 4
first. The runbook orders things so the Google side is updated first
(step 2), then AWS side (steps 3-5), so there's never a window where
Google rejects the AWS redirect.

## Branding the rest

This runbook only does the consumer pool. Repeat the pattern for the
other three pools when you're ready, with separate subdomains:

- `auth-business.areacode.co.za` for `us-east-1_ToRjJQAGY`
- `auth-staff.areacode.co.za` for `us-east-1_IgGAzUdON`
- `auth-admin.areacode.co.za` for `us-east-1_LekBhxy5y`

Or just keep them on the AWS-hosted domain — staff and admin don't see
the OAuth URL the same way customers do.
