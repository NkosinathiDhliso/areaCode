---
name: area-code-dev
description: Development workflow for the Area Code project
---

# Area Code Development

## Build and Test

```bash
pnpm typecheck                        # TypeScript check (whole repo)
pnpm test                             # Run all tests (vitest)
pnpm --filter backend build:lambda    # Build Lambda bundles
pnpm --filter @area-code/web build    # Build web app
pnpm --filter @area-code/business build
pnpm --filter @area-code/admin build
pnpm --filter @area-code/staff build
```

## Deploy

```bash
# Full deployment (build + terraform + lambda upload)
./scripts/deploy-serverless.ps1

# Update Amplify frontend env vars and trigger rebuilds
./scripts/update-all-amplify-apps.ps1 -ApiUrl "https://..." -WebSocketUrl "wss://..."

# Or push to master branch to auto-trigger Amplify builds
git push origin master
```

## Adding a New API Route

1. Create handler in `backend/src/features/{domain}/handler.ts`
2. Add route in the feature's `authRoutes`/`nodeRoutes`/etc function
3. Create service function in `service.ts`
4. Create repository function in `repository.ts` (DynamoDB operations)
5. Add types/schemas in `types.ts` (Zod validation)
6. Register the feature plugin in `backend/src/app.ts` with `await app.register()`
7. Build and deploy: `pnpm --filter backend build:lambda` then upload zip

## Adding a New Frontend Screen

1. Create component in `apps/{app}/src/screens/{ScreenName}.tsx`
2. Keep under 300 lines. Extract sub-components if needed
3. Use CSS variables for all colors
4. Mobile-first for consumer and staff apps
5. Add route handling in the app's `App.tsx`
6. Add i18n keys in `src/i18n/locales/en.json`

## DynamoDB Patterns

- Table names from env vars: `process.env['USERS_TABLE'] || 'area-code-prod-users'`
- Generic KV store in app-data table: `pk: KV#{key}`, `sk: VALUE`
- City records: `pk: CITY#{slug}`, `sk: CITY#{slug}`
- Use `documentClient` from `backend/src/shared/db/dynamodb.ts`
- TTL field for auto-expiry (rate limits, sessions)

## Cognito Patterns

- Client wrapper: `backend/src/shared/cognito/client.ts`
- Four pools, accessed via `getPool(role)` helper
- Custom attributes: `custom:userId`, `custom:citySlug` on consumer pool
- OTP sessions stored in DynamoDB KV with 5-min TTL

## Common Gotchas

- `awsLambdaFastify()` must be called BEFORE `app.ready()`, not after
- Plugin registration: use `await app.register()`, never `void app.register()`
- PowerShell JSON quoting: use file-based JSON for AWS CLI commands
- Amplify builds from git, not local. Changes must be pushed to take effect
- SNS SMS sandbox: new AWS accounts can only send to verified numbers
- API Gateway WebSocket route keys cannot contain colons
