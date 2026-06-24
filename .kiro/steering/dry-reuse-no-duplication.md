# Reuse first. Never duplicate. Edit in place.

This is a hard engineering rule for the whole codebase, not a style preference.
Read it before creating any new file, function, type, component, hook, or
infrastructure block.

## The principle

There must be exactly one home for any given piece of logic, configuration, or
knowledge. Before you write something new, find what already exists and reuse or
extend it. Duplication is a defect — it drifts, and the copies disagree.

## Hard rules

1. **Search before you create.** Before adding a function/component/hook/type/
   helper/IAM block, grep the repo for an existing one that does the same or a
   similar job. If it exists, import and reuse it. If it almost fits, extend it
   (add a parameter, widen a type) rather than forking a copy.
2. **Edit files in place; do not recreate them.** When changing existing code,
   modify the existing file with a targeted edit. Never rewrite a whole file
   from scratch when a small change will do, and never create a parallel
   `foo2.ts` / `foo.new.tsx` / `fooCopy` variant. Replacing the entire contents
   of a file is only acceptable when the change genuinely touches most of it.
3. **One source of truth per concept.**
   - Cross-app code (types, API client, stores, UI primitives, constants) lives
     in `packages/shared` and is imported by `apps/*`. Do not redefine a shared
     type or re-implement a shared helper inside an app.
   - Backend domain logic lives once in the relevant `backend/src/features/*` or
     `backend/src/shared/*` module. Handlers call services; services call
     repositories. Do not inline a second copy of a query or a Cognito/SES/KV
     call that already has a wrapper.
   - Infra patterns live in `infra/modules/*` and are instantiated per
     environment. Do not copy a module's resources inline into an environment.
4. **Extend, don't fork.** If two call sites need slightly different behaviour,
   parameterise the single implementation. Two near-identical blocks that must
   change together is the smell this rule exists to prevent.
5. **Reuse the established mechanism.** Use the existing API client
   (`packages/shared/lib/api`), the existing stores, the existing email module
   (`backend/src/shared/email/ses.ts`), the existing KV store
   (`backend/src/shared/kv`), the existing auth middleware, and the existing
   validation/error helpers. Do not hand-roll a `fetch`, a new SES client, or a
   bespoke error shape when the shared one exists.
6. **Shared constants, not magic values.** Reuse the constants already defined
   (e.g. legal versions, route paths, table-name accessors) instead of
   re-typing literals that must stay in sync.

## What to do when reuse isn't clean

- If the existing thing is close but awkward, **refactor it** so both callers
  share it — then both use the improved single version. Note the refactor.
- If you genuinely need something new, put it where it belongs (shared package
  for cross-app, the right feature module for backend) so the next person finds
  and reuses it instead of making a third copy.
- If you find existing duplication while working, prefer consolidating it over
  adding a third instance. Flag larger consolidations rather than silently
  doing a big refactor mid-task.

## Why

Duplicated code and re-created files are the main way this project would rot:
copies drift out of sync, bugs get fixed in one place but not the others, and
the "source of truth" becomes ambiguous. A bootstrapped team cannot afford to
maintain three versions of the same thing. One home, reused everywhere.
