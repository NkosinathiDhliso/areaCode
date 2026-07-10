# Decision: map membership (which venues appear on the consumer map)

Date: 2026-07-10

Spec: audit-gap-closure Requirement 7.1, 7.2. Related:
`.kiro/steering/discovery-dna-vibe-over-convenience.md`,
`.kiro/steering/product.md`.

## Context

The consumer map today shows only paid-tier venues. The rule lives in
`backend/src/features/nodes/repository.ts` `getNodesByCitySlug`: a node joins the
map only when it has an owning business on a paid tier (`starter`, `payg`,
`growth`, `pro`). Free-tier businesses and orphan/legacy nodes (no `businessId`)
are excluded entirely. The broadcast path in `nodes/service.ts` mirrors this:
a node is only surfaced and broadcast when its business is on a paid tier.

The question was left open because the audit found the code, code comments, and
product docs did not clearly state one answer. Two adjacent, easily-confused
mechanisms made this worse:

1. **Map MEMBERSHIP** is a hard gate: are you on the map at all? Today this is
   paid-tier-only, keyed off the STORED tier plus `isActive`.
2. **Tier as a ranking LEVER** is a soft advantage: `vibeRank`
   (`apps/web/src/lib/carouselRanking.ts`) already lets business tier break ties
   among equally-alive, equally-taste-matched venues, sitting below taste and
   aliveness. This is founder-approved and stays.

These are separate. The open question is only about (1), the membership gate, not
about (2), which is settled.

The tension worth recording:

- **`discovery-dna-vibe-over-convenience.md`:** ranking is by aliveness and
  taste, and tier is only a minor lever within that. A paid-only MEMBERSHIP
  filter is a coarser gate than the tier lever, and it means some alive,
  taste-matched free venues never reach ranking at all.
- **The flywheel:** more venues on the map means more aliveness signal and a
  livelier city; paid-only membership means a cleaner monetization story but a
  thinner map early on.
- **Free-tier onboarding:** a business that just onboarded on the free tier does
  not appear on the consumer map at all today. Its first map presence requires a
  paid tier.

## Options

- **Option A: paid-only map membership (status quo).** Only venues whose owning
  business is on a paid tier appear. Free-tier and orphan nodes are hidden. This
  is exactly what the code does now.
- **Option B: all venues shown, tier advantages ranking only.** Every active
  venue joins the map; business tier stays a ranking lever within `vibeRank`
  caps (as it already is) but is no longer a membership gate. More aliveness
  signal, weaker paid-tier incentive, and a free onboarded venue is visible
  immediately.
- **Option C: another model** (for example a capped number of free venues per
  city, or free venues visible only above a live-presence threshold). More
  moving parts and more surface to get wrong.

## Decision

**Option A: paid-only map membership (status quo).**

Rationale:

- It matches the shipped behaviour, so recording it changes nothing at runtime.
  Requirement 7.2 states any behaviour change is a follow-up spec; recording the
  status quo keeps that true.
- Map membership stays a clean, single gate: paid tier plus `isActive`. The one
  removal mechanism is storage demotion (`deactivateForNonPayment`) after the
  grace window, so there is no second, drifting removal path.
- The discovery-DNA tension is real but contained: tier already participates in
  ranking as a minor lever below taste and aliveness. The membership gate is a
  separate, coarser decision about who is on the map at all, and keeping it
  paid-only preserves the paid-reach product without touching the ranking rule.
- Moving to Option B or C is a genuine product and monetization change (it
  affects what free-tier businesses get and how full the early map looks). That
  decision deserves its own spec with its own analysis, not a silent flip here.

## Consequences

- What stays: only paid-tier venues appear on the consumer map. Free-tier and
  orphan nodes remain hidden. Tier continues to act as a minor ranking lever in
  `vibeRank`, unchanged. No code behaviour changes from this record.
- `rules/product.md` now states the paid-only membership rule explicitly and
  references this record. Code comments in `nodes/repository.ts` and
  `nodes/service.ts` already describe this behaviour.
- Any move to Option B (all venues shown, tier as ranking advantage only) or
  Option C (another model) is a follow-up spec. That spec would need to cover the
  free-tier onboarding experience, the flywheel impact of a fuller map, and how a
  paid tier still earns reach once membership is no longer the gate.
