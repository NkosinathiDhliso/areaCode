# Area Code — Engineering Standards
## Code Quality & Maintainability Guidelines

**Version:** 1.0
**Effective Date:** March 30, 2026
**Status:** Enforceable via CI/CD Pipeline

---

## Philosophy

Area Code follows elite engineering organisation standards. **Bad code cannot merge.** Quality gates are enforced automatically in CI/CD, not through code review alone.

### Hybrid Package-by-Feature Architecture

The codebase uses a **hybrid approach** — not pure feature, not pure layer. Feature-based organisation groups files by functionality, which aligns closely with product features and simplifies onboarding. Inside each feature you still maintain the layer structure (route → service → repository in the backend; component → hook → store in the frontend). The layers become private to the feature rather than global folders that everything dumps into.

The key advantage of package-by-feature over package-by-layer: you can make internals package-private. When everything is in global layers, everything has to be public, and it becomes very hard to prevent a "big ball of mud."

**One reason to exist, one reason to change.** If a file needs a second reason, it splits. The 400-line and 150-line limits are the measurable tripwires that tell you when you've violated single responsibility.

### Dependency Direction (Non-Negotiable)

**Backend:**
- `routes/` calls `services/` only — never `repositories/` directly
- `services/` calls `repositories/` only — never other services in a chain
- `repositories/` calls the DB/Redis client only — never other repositories
- Cross-domain logic goes through `backend/src/shared/interfaces/` — never direct cross-service imports
- `backend/src/shared/` never imports from feature modules

**Frontend:**
- `packages/features/*` imports from `packages/shared/*` only — never from another feature's internals
- `packages/shared/` never imports from `packages/features/*`
- `apps/*` imports from `packages/*` only
- `packages/*` never imports from `apps/*`
- Feature barrel exports: each feature has `index.ts` exporting only public components and hooks

---

## File & Code Structure Standards

### File Size Limits

| Metric | Warning | Build Failure | Rationale |
|--------|---------|---------------|-----------|
| **File Size** | 300 lines | **400 lines** | Split at 300, hard stop at 400 |
| **Function/Method** | 30 lines | **150 lines** | Netflix Checkstyle default — enforces focused, testable functions |
| **React Component** | 200 lines | **300 lines** | Components should be composable and focused |
| **Line Length** | 100 chars | **120 chars** | Netflix standard — improves readability and diff reviews |

### Complexity Limits

| Metric | Warning | Build Failure | Tool |
|--------|---------|---------------|------|
| **Cyclomatic Complexity** | 10 | 15 | SonarCloud |
| **Cognitive Complexity** | 15 | 25 | SonarCloud |
| **Nesting Depth** | 3 levels | 4 levels | ESLint |
| **Import Count** | 10 imports | 15 imports | ESLint |

### Code Smells (Auto-detected, PR-blocking)

- **God Object** — Files with >10 exported functions or >400 lines
- **Long Method** — Functions exceeding 150 lines
- **Deep Nesting** — More than 4 levels of indentation
- **Tight Coupling** — More than 15 imports in a single file
- **Missing Error Handling** — Unhandled promise rejections, unchecked async errors
- **Type Safety Issues** — TypeScript files with >5 `any` annotations
- **Code Duplication** — Identical blocks >5 lines across files

---

## Backend Architecture Standards

### Fastify Route Handler Structure

Every route handler follows this exact order. Deviating from this order is a bug waiting to happen:

```
1. JWT verification (preHandler middleware) → 401
2. Role check (consumer / business / staff / admin) → 403
3. Zod input validation (body, params, query) → 400
4. Rate limit check (Redis via shared middleware) → 429
5. Service layer call (business logic only here)
6. Repository call (DB operations inside service)
7. Redis state update (if real-time state changes)
8. Socket.io emit (if broadcast is needed)
9. Return 200/201
```

### Service Layer Rules

- Services contain **all** business logic — no logic in routes, no logic in repositories
- Services never access `req` or `reply` — they receive plain typed arguments
- Services never import from other service files directly
- If two services need shared logic, extract it to `backend/src/shared/`

### Repository Layer Rules

- Repositories contain **only** DB and Redis queries — zero business logic
- One repository file per domain (e.g., `checkInRepository.ts`, `nodeRepository.ts`)
- All Prisma queries go through the repository — no `prisma.*` calls in services or routes
- Raw PostGIS queries use `prisma.$queryRaw` with `Prisma.sql` template tags — never string interpolation

```typescript
const result = await prisma.$queryRaw<ProximityResult[]>(Prisma.sql`
  SELECT ST_DWithin(
    ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
    location::geography,
    200
  ) AS within_range
  FROM nodes WHERE id = ${nodeId}
`)
```

### Error Handling

All route errors go through `AppError` from `backend/src/shared/errors/AppError.ts`. Never throw raw JS errors or return untyped error objects to clients.

```typescript
throw new AppError(403, 'Insufficient tier for this feature')
```

Async errors in handlers must be caught. Use Fastify's `setErrorHandler` globally. Never let uncaught promise rejections escape a handler.

### Background Workers

Workers (pulse decay, leaderboard recalc, cleanup) run as separate Lambda handlers on EventBridge schedules. They must:
- Be idempotent — safe to run twice without side effects
- Log with `[worker-name]` prefix for CloudWatch filterability
- Handle their own errors without crashing the worker process
- Write a completion summary log at the end (count of records processed)

---

## Frontend Architecture Standards

### Component Rules

- **One component per file.** No exporting two components from the same file.
- **No inline business logic.** Components render state — services and hooks fetch and transform it.
- **Props interfaces defined in the same file,** above the component. Not in a separate types file unless shared.
- **No `any` in component props.** Every prop must be typed.

### Hook Rules

- Hooks encapsulate **one concern** — a hook that fetches data and manages form state should be two hooks.
- Hooks in `packages/shared/hooks/` are platform-agnostic — no DOM APIs, no `window`, no `document`.
- Every hook that sets up a subscription or interval **must clean up** in its return function.

### Store Rules (Zustand)

- Stores live in `packages/shared/stores/` — never create a store inside a feature folder.
- Store files use `immer` middleware for all state mutations — no manual spread copying.
- Stores contain **state and actions only** — no async fetch logic in stores. Async goes in hooks via React Query.

### React Query Rules

- `queryKey` arrays must be descriptive and consistent: `['node', nodeId]`, `['user', 'me']`
- `staleTime` must always be set — never leave it at 0 for data that doesn't change every second
- Mutations must call `queryClient.invalidateQueries` for all affected query keys on success
- Never put loading/error state management in components — use the `isPending`, `isError` values from the hook

---

## Real-Time Architecture Standards

### Socket.io Rules

- **One socket instance** — `packages/shared/lib/socket.ts` exports a singleton. Never instantiate `io()` in a component.
- **Room joins/leaves must be symmetric** — every `room:join` emit must have a corresponding `room:leave` in the cleanup.
- **Never emit from a component directly.** Emit through a hook or service function.
- **Socket event handlers must be typed.** Define event payload interfaces in `packages/shared/types/index.ts`.

```typescript
interface SocketEvents {
  'node:pulse_update': (payload: NodePulseUpdate) => void
  'toast:new': (payload: ToastPayload) => void
  'reward:slots_update': (payload: RewardSlotsUpdate) => void
}
```

### Redis Rules

- All Redis key patterns are defined in `backend/src/shared/redis/keys.ts` — never construct key strings inline.
- TTLs must always be set on ephemeral keys (cooldowns, presence, toast queues).
- Redis is **never** the source of truth for persistent data — only for real-time ephemeral state.
- If Redis is unavailable, the system degrades gracefully — nodes render as `dormant`, features that require Redis return a 503 with a retryable flag.

---

## CI/CD Pipeline Enforcement

### Quality Gates (Must Pass to Merge)

```yaml
Quality Gate Configuration:
  Code Coverage: ≥80%
  Duplicated Lines: <3%
  Maintainability Rating: A or B
  Reliability Rating: A
  Security Rating: A
  Technical Debt Ratio: <5%
```

### Toolchain

| Tool | Purpose | Configuration |
|------|---------|---------------|
| **SonarCloud** | Static analysis, code smells, security | Quality gate enforced on PR |
| **ESLint** | TypeScript/React linting | Flat config (`eslint.config.js`), `typescript-eslint` + `react-hooks` + `import` plugin |
| **TypeScript strict** | Type safety | `"strict": true` in all `tsconfig.json` — no exceptions |
| **Prettier** | Code formatting | 120 char line length, enforced pre-commit |
| **Vitest** | Frontend unit tests | Co-located test files, `*.test.ts` / `*.test.tsx` |
| **Husky** | Git hooks | Pre-commit: format + lint; Pre-push: test |
| **Zod** | Runtime validation | All API inputs validated with Zod schemas — no manual `if` checks on request bodies |

### GitHub Actions Workflow

```yaml
name: Quality Gate
on: [pull_request]

jobs:
  quality-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: SonarCloud Scan
        uses: SonarSource/sonarqube-scan-action@v7.0.0
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}

      - name: Lint Frontend
        run: npx eslint packages/ apps/ --max-warnings 50

      - name: TypeScript Check
        run: npx tsc --noEmit

      - name: Lint Backend
        run: cd backend && npx eslint src/ --max-warnings 50

      - name: Run Tests
        run: |
          npx vitest run --coverage
          cd backend && npm test -- --coverage

      - name: Check Coverage
        run: ./scripts/check-coverage.sh
```

---

## Database & Migration Standards

### Migration Rules

- Migrations are **append-only** — never modify or delete an existing migration file
- Always use `IF NOT EXISTS` / `IF EXISTS` — makes migrations idempotent and re-runnable
- Always test on `dev` environment before running on `prod`
- Write a new forward migration to fix mistakes — do not rely on rollbacks in production
- The `run-migration` Lambda ZIP must include the `migrations/` directory alongside the handler

### Prisma Rules

- Schema changes always come with a migration file — never use `prisma db push` in any environment
- All models use `@map` and `@@map` to maintain `snake_case` DB columns while using `camelCase` in code
- No `select: {}` returning all fields on queries that run at scale — always specify required fields

---

## Refactoring Strategy

### Priority Order

#### Phase 1 — Quick Wins (1–2 weeks)
**Target: High-complexity functions**

- Extract helper functions, reduce nesting, simplify conditionals
- Each file refactored in a single focused PR
- Use SonarCloud complexity reports to identify targets

#### Phase 2 — Medium Files (2–4 weeks)
**Target: Frontend components and backend route handlers exceeding 400 lines**

- Split by responsibility
- Extract hooks, services, sub-components
- Apply single-responsibility at every layer

#### Phase 3 — Architectural Surgery (1–3 months)
**Target: Any file exceeding 1000 lines**

- Full redesign with incremental migration
- Cover with tests before refactoring
- Migrate feature by feature, not all at once

### PR Template for Refactoring

```markdown
## Refactor: Reduce complexity in [filename]

**Before**: Cyclomatic complexity: 25 / Lines: 480
**After**: Cyclomatic complexity: 11 / Lines: 210

**Changes**:
- Extracted X helper functions
- Reduced nesting from 5 to 3 levels
- Simplified conditional logic

**Testing**: All existing tests pass, added N new unit tests
```

---

## Exceptions & Waivers

Waivers may be granted for:
- Generated code (Prisma client output, protobuf, GraphQL schemas)
- Legacy code scheduled for deprecation with a tracked issue
- Third-party integrations with unavoidable complexity

**Waiver process:**
1. Create GitHub issue with `quality-waiver` label
2. Document: why needed, temporary/permanent, mitigation plan
3. Add `// eslint-disable-next-line [rule] -- waiver: #issue-number` comment

---

## Metrics & Monitoring

### Weekly (SonarCloud Dashboard)

- **Maintainability Index** — target 70+/100
- **Technical Debt Ratio** — target <5%
- **Code Coverage** — target ≥80%
- **Duplicated Lines** — target <3%
- **Critical/Blocker Issues** — target 0

### Monthly Review

- Trend analysis (improving/degrading)
- Top 10 technical debt files
- Refactoring progress vs. plan
- Quality gate pass rate

---

## Resources

- **SonarCloud**: https://sonarcloud.io/
- **ESLint Config**: `eslint.config.js` in project root
- **SonarCloud Config**: `sonar-project.properties` in project root
- Google Code Review Guidelines: https://google.github.io/eng-practices/
- Clean Code — Robert C. Martin (required reading)
