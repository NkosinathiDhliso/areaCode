<!-- GENERATED FILE. DO NOT EDIT.
     Single source of truth: rules/*.md
     Regenerate with: pnpm sync:rules -->

---
inclusion: always
---

# Honest presence: the live signal must be true

Read this before touching check-in, check-out, presence expiry, the live count,
pulse score, or any "who's here / how alive" surface.

## The principle

**Every live signal reflects reality. A count is who is _actually there now_, not
who showed up at some point.** We would rather show an honest empty room than a
fake busy one.

## Why this is non-negotiable

The whole product is trust in a live signal. One trip to a venue the app said was
buzzing that turns out dead, and the user never trusts the map again — they
revert to convenience permanently. Honesty is the moat, not a nicety. A fake pull
is worse than no pull.

## Hard rules

1. **Counts reflect current presence.** The live count / pulse is backed by
   check-in plus check-out (manual) and automatic expiry of stale presence. It is
   never an undecaying cumulative tally of everyone who ever checked in.
2. **Presence expires.** A check-in with no check-out must not keep a person
   "present" forever. Presence expires after a bounded window so a venue cannot
   stay falsely alive overnight.
3. **Claims must be backed by real data.** Do not render "your crowd is here,"
   "people like you here," or "filling up" unless the underlying presence data is
   real and current. If the data is not there, say less — never fake more.
4. **Under-claim, never over-claim.** When presence confidence is low, soften the
   copy ("quiet right now") rather than inventing activity.
5. **Momentum requires departures.** "Filling up" / "winding down" may only be
   shown when check-out and expiry make the trend genuinely measurable — you
   cannot show a venue emptying without a way for people to leave.
6. **Privacy stays intact (POPIA).** Presence is aggregate and anonymised; never
   expose individual identities and never build a location history. Proximity is
   evaluated for verification, then discarded (see the project privacy posture).
   Distance-based auto-checkout is mobile-only, explicitly consent-gated, and must
   not persist a location trail.

## What this enables (the upside)

Honest check-in + check-out yields **dwell time** — how long people actually
stay — which is real venue intelligence the business side can sell, and the
foundation for the belonging and momentum magnets in the discovery DNA rule.
