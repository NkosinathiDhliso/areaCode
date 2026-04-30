---
inclusion: auto
---

# Area Code Project Context

## What It Is

A map-first social discovery app for South African cities.
Venues appear as animated nodes on a live map. Nodes pulse based on check-in activity.
Users earn rewards ("gets") by checking in. Leaderboards and streaks drive retention.

## Current State

- Live in production at areacode.co.za
- Serverless: Lambda monolith + API Gateway + DynamoDB + Cognito
- Four frontend apps: web (consumer), business, staff, admin
- Three cities seeded: Cape Town, Johannesburg, Durban
- SMS OTP via Cognito CUSTOM_AUTH + SNS (sandbox mode, pending exit)

## Key URLs

- Consumer: https://areacode.co.za
- Business: https://business.areacode.co.za (SSL propagating)
- Staff: https://staff.areacode.co.za
- Admin: https://admin.areacode.co.za
- API: https://iyj02gvt12.execute-api.us-east-1.amazonaws.com
- WebSocket: wss://ilcimxarf0.execute-api.us-east-1.amazonaws.com/prod

## Repo Structure

- `apps/web` - Consumer app (React + Vite, mobile-first)
- `apps/business` - Business dashboard (React + Vite, responsive)
- `apps/staff` - Staff validator (React + Vite, mobile-first)
- `apps/admin` - Admin panel (React + Vite, responsive)
- `apps/mobile` - Expo React Native (shares packages/)
- `packages/shared` - Shared hooks, stores, lib, types, constants
- `backend` - Fastify API (Lambda monolith)
- `infra` - Terraform modules and environments

## Database

DynamoDB tables (pay-per-request):
- users, nodes, checkins, rewards, businesses
- app-data (generic KV: cities, consent, rate limits, OTP sessions)
- websocket-connections (WebSocket API connection tracking)

## Auth

Four Cognito pools: consumer, business, staff, admin.
Consumer/business/staff use CUSTOM_AUTH (phone OTP via SNS).
Admin uses email/password (ADMIN_USER_PASSWORD_AUTH).
