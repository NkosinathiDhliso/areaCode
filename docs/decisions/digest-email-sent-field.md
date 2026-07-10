# Decision: Digest_Row `emailSent` field (flip after send vs remove)

Date: 2026-07-10

Spec: audit-gap-closure Requirement 7.3. Related:
`.kiro/steering/no-fallbacks-no-legacy.md`,
`.kiro/steering/dry-reuse-no-duplication.md`.

## Context

The Weekly Attribution Digest writes one Digest_Row per business per week
(`backend/src/features/reports/repository.ts`, `pk: DIGEST#<businessId>`,
`sk: WEEK#<weekStartIso>`). The row carries an `emailSent: boolean` field
(`reports/types.ts` `digestRowSchema`).

Today `emailSent` is always written `false` and never flipped. The generator
(`reports/generator.ts` `processRecord`) persists the row with `emailSent: false`
via a conditional put (`attribute_not_exists(pk)`), and on a newly `written`
result sends the Digest_Email. A successful send is only logged, never written
back. The field therefore never carries real signal: every persisted row reports
`emailSent: false` regardless of whether the email actually went out.

That is dead, misleading state. It reads as "we track whether the digest email
was delivered" while in fact recording nothing. `no-fallbacks-no-legacy.md` bans
exactly this kind of meaningless remnant: either the field tells the truth or it
should not exist.

Two mechanisms are worth separating:

1. **The idempotence write.** `persistDigest` does the single conditional put
   that guards Property 4 (exactly one Digest_Row write per business-week, so a
   replay is a no-op and the Digest_Email is never resent). This is the only gate
   and must not change.
2. **The `emailSent` state.** Whether the email for that row was successfully
   dispatched. This is separate from idempotence and is what the field is meant
   to record.

## Options

- **Option A: flip after send.** Keep `emailSent` in the schema. After a
  successful `sendDigestEmail`, issue a second, best-effort `UpdateCommand`
  setting `emailSent = true` on the existing row (`businessId` + `weekStart`
  key), conditional on the row existing (`attribute_exists(pk)`). The guarding
  conditional put in `persistDigest` is untouched. A failed flip is logged and
  swallowed: it does not throw, does not roll back the row, and does not resend.
- **Option B: remove the field.** Drop `emailSent` from `DigestRow` and
  `digestRowSchema`, and remove every read/write of it. The digest send outcome
  would then be observable only through logs.

## Decision

**Option A: flip after send** (the design's recommended option).

Rationale:

- The field then carries real signal: did the digest email actually go out for
  this week? That is useful for ops and debugging (a support query, a "did my
  business get its digest?" check) and it is already surfaced by the digest view
  service, so removing it would lose a read the dashboard side already maps.
- The idempotence guarantee is preserved. The flip is a separate, additive
  best-effort update, not part of the conditional put. `persistDigest` stays the
  single guarding write, so Property 4 still holds: a replay of the same week
  still hits `attribute_not_exists(pk)`, gets `duplicate`, and sends nothing.
- A failed flip is safe by construction. The row was already persisted before the
  send, the email was already sent, and the flip only updates a status flag. If
  the flip fails, we log loudly and move on: the row is not lost and the email is
  not resent. This is intended best-effort behaviour on a non-critical status
  write, not a silent swallow of a critical path (the row and the email are the
  critical path, and both are already handled).
- The write lives in the repository layer (`markDigestEmailSent`), so the
  generator (a worker) does not inline a DynamoDB call, matching the
  handler/service/repository layering and keeping one home for digest writes.

Option B was rejected because the field is genuinely useful once it is honest,
and it is already read by the digest view path; removing it would drop a real
ops signal to fix a problem that a one-line flip fixes better.

## Consequences

- `emailSent` stays in `DigestRow` and `digestRowSchema`.
- A new repository function `markDigestEmailSent(businessId, weekStart)` issues
  the conditional (`attribute_exists(pk)`) update setting `emailSent = true`.
- The generator calls it after a successful `sendDigestEmail`, wrapped so any
  failure is logged (`console.error`) and never thrown. The row persists with
  `emailSent: false` and is flipped to `true` only on a confirmed send.
- `emailSent` now reflects reality: `true` means the digest email for that week
  was dispatched successfully; `false` means it was not (opt-out, no address,
  send failure, or a flip that itself failed).
- Property 4 (single Digest_Row write per week, idempotent replay) is unchanged:
  the conditional put in `persistDigest` is the only idempotence gate and the
  flip is a separate best-effort update.
- No behaviour change to the send-suppression paths (duplicate replay, opt-out,
  missing email): those still skip the send and therefore never flip the field.
