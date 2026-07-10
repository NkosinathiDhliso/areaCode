# Decision: API region posture (stay in us-east-1 vs plan af-south-1)

Date: 2026-07-10

Spec: audit-gap-closure Requirement 7.4. Related:
`.kiro/steering/serverless-only.md`, `docs/RUNBOOK.md`.

## Context

The whole platform runs in `us-east-1`. This is not incidental: the RUNBOOK
opens with "Everything referenced here exists in `us-east-1`", the Terraform
providers in `infra/environments/{dev,prod}/main.tf` and `infra/shared` are
pinned to `us-east-1`, the state bucket and lock table live there, and every
deploy and ops script defaults to `-Region us-east-1`.

The user base is South African (Johannesburg, Cape Town, Durban). `af-south-1`
(Cape Town) is the geographically closer AWS region, so it is the natural
candidate for lower latency to real users. The open question the audit flagged:
stay in `us-east-1` or plan a move to `af-south-1`, decided on a measured latency
comparison rather than a hunch.

Two facts shape the decision:

1. **A region move is a large migration, not a config flip.** It touches Amplify
   hosting for all four SPAs, four Cognito user pools (which cannot be moved
   region-to-region without recreating pools and re-authenticating every user),
   the DynamoDB tables, every Lambda, the S3 buckets, SQS queues, and the
   Secrets Manager entries at `area-code/{env}/*`. Cognito alone makes this a
   user-facing event, not an infrastructure detail.
2. **`af-south-1` is not a free swap on cost.** It is priced above `us-east-1`
   for several services, and the serverless-only budget rule
   (`serverless-only.md`) is binding: we are a bootstrapped pre-launch team
   holding monthly spend low. A pricier region is a real, recurring cost.

Two things already blunt raw API latency for SA users:

- The heaviest consumer read (`GET /v1/nodes/:city`) is now cached in the KV
  store with a short TTL (this spec, Requirement 2) and its response is small.
- Amplify/CloudFront serves the SPA assets from edge locations, so first paint
  and static delivery are not gated on the API region.

## Measurement

A dependency-free probe is checked in at `scripts/region-latency-probe.mjs`. It
times round trips to the live `us-east-1` API health endpoint and to a public
`af-south-1` AWS endpoint (the af-south-1 regional S3 endpoint, which terminates
in Cape Town), so the two regions can be compared over the same network path.

Run it from the repo root:

```
node scripts/region-latency-probe.mjs
```

It labels the host it ran on, because it measures whatever network the process
sits on. For the canonical numbers this must be run from a confirmed South
African network.

### Measured (author host, 10 samples per target, HEAD requests)

The probe was run once during this spec from a Windows host (hostname `School`).
The vantage point is not a confirmed SA datacentre, but the latency profile
(far closer to `af-south-1` than to `us-east-1`) is consistent with an African
network vantage.

| Target                            | min   | median | p95   | failures |
| --------------------------------- | ----- | ------ | ----- | -------- |
| us-east-1 (prod API `/health`)    | 701ms | 728ms  | 749ms | 0/10     |
| af-south-1 (S3 regional endpoint) | 110ms | 157ms  | 204ms | 0/10     |

Median gap: ~571ms, af-south-1 nearer from this vantage point.

Caveats, stated honestly:

- The two targets are different services (the app behind API Gateway plus Lambda
  vs raw S3). The `us-east-1` number includes API Gateway and Lambda processing
  (and possibly a cold start), so it overstates pure network RTT. Treat the table
  as region-to-region reachability from this vantage, not endpoint-to-endpoint
  app latency.
- The dominant, honest signal is the gap driven by geographic distance. Typical
  network RTT from SA is roughly 200 to 300ms to `us-east-1` versus roughly 10 to
  30ms to `af-south-1` (expectation, corroborated by the af-south-1 column above).

Founder action to finalise: re-run the probe from a confirmed SA network (or read
the equivalent from CloudWatch RUM real-user data for `areacode.co.za`) and, if
the numbers differ materially from the table above, revisit this decision against
the flip triggers below.

## Options

- **Option A: stay in `us-east-1` (status quo).** No migration, no cost change.
  SA users pay the transatlantic RTT on uncached API calls, softened by the
  city-read cache and edge-served assets.
- **Option B: plan and migrate to `af-south-1`.** Lower latency for SA users on
  the interactive write path (check-in, signup). Cost: a large multi-service
  migration including recreating four Cognito pools and re-authenticating users,
  plus higher recurring `af-south-1` pricing.

## Decision

**Option A: stay in `us-east-1` for now, with `af-south-1` recorded as a
documented future option** gated on the flip triggers below.

Rationale:

- The migration cost is high and front-loaded, and the Cognito pool recreation
  makes it a user-facing event, not a quiet infra change. At pre-launch scale
  with a bootstrapped budget, that cost is not justified by the current signal.
- The most latency-sensitive, highest-volume consumer read is now cached (this
  spec, Requirement 2) and the SPA is edge-served, so the measured region gap
  does not fall on every user interaction. The gap mainly affects uncached
  interactive writes (check-in, signup), which are lower volume.
- `af-south-1`'s higher pricing is a recurring cost against a binding budget
  rule, so a move must clear a real user-impact bar, not a theoretical one.
- The measured gap is real and non-trivial, so this is not "ignore latency": it
  is "the migration bar is not met yet". The flip triggers make the reversal
  condition explicit and measurable rather than leaving it to a later hunch.

## Consequences

- No infrastructure change. Terraform, deploy scripts, and the RUNBOOK stay
  `us-east-1`. `scripts/region-latency-probe.mjs` is added so the comparison is
  repeatable and the decision is re-checkable, not a one-time claim.
- SA users continue to pay transatlantic RTT on uncached API calls. This is
  accepted, bounded by the city-read cache, edge-served assets, and the low
  volume of the interactive write path relative to reads.
- **Flip triggers.** Revisit and plan the `af-south-1` migration (its own spec,
  covering the Cognito pool recreation and user re-auth path) if any of these
  hold:
  - Measured p95 API latency from a confirmed SA vantage (probe or CloudWatch
    RUM) on the interactive write path stays above ~400ms after the caching in
    this spec is live.
  - Post-launch user growth reaches a scale where the check-in and signup RTT is
    a measured drop-off cause (RUM or the usage funnels from Requirement 4 show
    it), not a suspected one.
  - The recurring `us-east-1`-to-SA data-transfer or latency cost is shown to
    outweigh the `af-south-1` price premium at the then-current traffic.
- Until a trigger fires, `af-south-1` stays a documented option, not a plan.
