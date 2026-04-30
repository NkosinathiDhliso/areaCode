---
inclusion: auto
---

# Area Code Coding Standards

## Writing Style

- Never use em dashes in code, comments, docs, or chat responses
- Never use emojis in system UI (navigation, headings, buttons, labels)
- Keep responses concise. No filler. No superlatives
- Use plain language. Short sentences

## Code Limits

- Files: 400 lines max (warn at 300)
- Functions: 150 lines max (warn at 30)
- React components: 300 lines max (warn at 200)
- Line length: 120 chars max

## Platform Design

- Consumer web and mobile: mobile-first. Design for 375px width first
- Staff app: mobile-first. Simple, large touch targets
- Business app: responsive. Must work on both phone and desktop
- Admin app: responsive. Must work on both phone and desktop

## Styling

- All colors via CSS variables. Never use Tailwind color classes directly
- Cards: `rounded-2xl`. Bottom sheets: `rounded-t-3xl`
- No CSS grid in shared components (breaks React Native). Use flex
- Buttons: `active:scale-95` for tactile feedback
- Inputs: `rounded-xl` with `focus:border-[var(--accent)]`

## Code Patterns

- Hooks above all conditional returns
- Disable buttons during API calls with loading state
- Clean up useEffect subscriptions on unmount
- Error handling: check `statusCode` on API errors, show specific messages
- Never use `void` to discard promises from `app.register()`. Use `await`

## Auth

- Four separate Cognito pools, four separate auth stores
- Never create a shared `useAuth()` hook
- Token storage namespaced: `consumer:accessToken`, `business:accessToken`, etc
- Phone numbers normalized to E.164 (`+27...`) before API calls

## Backend

- Handler order: auth, role check, validation, rate limit, service, DB, socket, return
- DynamoDB tables referenced via env vars with fallback defaults
- Never return raw errors to client. Use typed `AppError`
- Rate limiting via DynamoDB TTL-based KV store

## Infrastructure

- All AWS resources through Terraform
- Lambda runtime: nodejs20.x, arm64
- Never `terraform apply` without `terraform plan` first
- Secrets in AWS Secrets Manager, not in env vars or code
