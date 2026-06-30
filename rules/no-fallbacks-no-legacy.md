# One source of truth. No fallbacks. No legacy. The silver-bullet path only.

This is a hard architectural rule for the whole codebase. Read it before adding
any `??` default, any `try/catch` that swallows, any "v2"/"legacy"/"old" code
path, any compatibility shim, or any second way to do a thing that already has a
first way.

## The principle

**There is exactly one correct path for every capability, and it is the path
that is right at scale, on cost, on security, on quality, and on data integrity.
We build that path and only that path. We do not keep a worse path beside it
"just in case."**

We are pre-launch. There is no production traffic to protect, no old client to
keep alive, no migration window to straddle. Every fallback and every legacy
remnant in this repo is pure liability — it drifts, it hides bugs, it doubles
the surface to secure and reason about, and it makes the source of truth
ambiguous. A bootstrapped team cannot afford two of anything.

## What is BANNED

1. **Silent fallbacks that mask failure.** No `catch {}` / `catch { return null }`
   / `catch { /* ignore */ }` that hides a real error. If an operation can fail
   in a way that matters, it must throw, log loudly, and surface — not degrade
   into a quiet wrong answer.
2. **Config defaults that mask misconfiguration.** No
   `process.env.X ?? 'some-default'` for anything required (bucket names, table
   names, URLs, keys, regions). Required configuration is validated once at
   startup and the process **crashes** if it is missing. A missing env var is a
   deploy bug, not a runtime guess.
3. **Legacy / dead / retired code.** No `*-legacy`, `*-old`, `*-v1`, `_archive`,
   `*-deprecated`, commented-out blocks, or "kept for reference" files. If it is
   not on the one live path, delete it. Git history is the archive.
4. **Duplicate / parallel implementations.** No second function, endpoint,
   table, schema, store, or component that does what an existing one does. One
   home per concept (see `dry-reuse-no-duplication.md`). If two exist, the
   inferior one is deleted, not deprecated.
5. **Dual data layers.** One database, one access pattern: DynamoDB single-table
   via the feature repositories. No second ORM, no leftover Prisma/SQL schema,
   no "we used to use X" model definitions.
6. **Speculative flexibility.** No abstraction, adapter, strategy switch, or
   feature flag added for a future that is not here. Build for the requirement
   in front of you; add the seam when the second real caller exists.
7. **Compatibility shims for clients that don't exist yet.** No response-shape
   doublewrites, no `nodeId`-and-`id`, no "support both the old and new field."
   Pick the right shape and use it everywhere.

## What is NOT a banned fallback (do not delete these)

The rule targets rot, not correctness. The following are the one correct path
and stay:

1. **User-facing graceful states.** A map that fails to load showing a retry
   screen, an empty-state when there is genuinely no data, an offline notice.
   These are designed product behaviour, not a hidden fallback.
2. **Fail-closed security.** Auth, authorization, and validation that **deny by
   default** when input is missing or wrong. Security defaults toward "no", and
   that default is mandatory, not a fallback.
3. **Honest-signal degradation.** Softening a live claim when presence
   confidence is low (see `honest-presence.md`) — that is the truthful path, not
   a fallback to fake data.
4. **Accessibility/environment branches.** `prefers-reduced-motion`, platform
   capability checks (Web Push vs Expo, WebGL availability) — these are distinct
   correct paths for distinct real environments, each fully owned.
5. **Intentionally-gated dead code that a binding steering rule protects.** e.g.
   the phone-OTP code frozen by `no-sms-no-phone-auth.md`. That rule wins; do not
   remove that code under this rule without the user explicitly overriding the
   other rule first. When this rule and another steering rule collide, **stop and
   confirm** rather than deleting.

The test to tell them apart: _does this branch produce an honest, intended
outcome, or does it hide a failure / keep a worse duplicate alive?_ The former
stays. The latter goes.

## How this applies across the dimensions

- **Scale:** the one path must be the one that holds at scale (serverless,
  pay-per-use, scales to zero — see `serverless-only.md`). No "simple version
  now, real version later" placeholder.
- **Cost:** one path means one thing to pay for and monitor. No idle duplicate
  resources, no second vendor doing a job a chosen vendor already does.
- **Quality:** one path is the one that gets all the tests, all the hardening,
  all the attention. Two paths split the care and both rot.
- **Security:** one path is the one surface to audit and lock down. Fewer paths,
  fewer holes. Fail closed, never open.
- **Database:** one schema, one source of truth per entity, no shadow copies and
  no second store that can disagree.
- **Product ownership:** one canonical implementation that the team owns and
  understands end-to-end. No orphaned code nobody owns or remembers.

## What to do when you find a fallback or legacy remnant

1. If it is unambiguous rot (dead file, silent catch, masking default, duplicate
   path), **delete/consolidate it in place** and make the one path correct.
2. If removing it changes runtime behaviour or touches a binding rule, **flag it
   and confirm** before deleting — do not silently change behaviour or override
   another steering rule.
3. After removing, verify: typecheck + build + tests must pass. A removal that
   breaks the build was load-bearing — understand why before forcing it.

## Why

Two of anything is a lie waiting to happen: the copies drift, a fix lands in one
and not the other, and "which one is real?" becomes a debugging tax forever.
Pre-launch is the one moment we can demand a single, correct, owned path for
everything at zero migration cost. We take it now so we never inherit the debt.
