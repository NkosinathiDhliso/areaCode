import { checkBoostFloor } from './service.js'
import type { BoostDuration } from './types.js'

/**
 * CloudWatch `PutMetricData` input shape, expressed as a structural type so the
 * caller can pass either the AWS SDK v3 `PutMetricDataCommand` invoke or a fake
 * recorder for tests, without taking a runtime dependency on `@aws-sdk/client-cloudwatch`.
 *
 * Only the fields we actually emit are typed. The `MetricName` is a union so
 * the same `putBoostMetric` adapter in `service.ts` can serve both call sites:
 *  - `BoostFloorViolation` (R9.5) — emitted by `decideBoostFloorWithMetric`
 *    when a checkout is rejected for being below the configured floor.
 *  - `BoostPurchaseAuditMissing` (R9.6) — emitted by `persistBoosterPurchase`
 *    when a `payment.succeeded` boost event fails to write its audit row.
 */
export interface BoostMetricInput {
  MetricName: 'BoostFloorViolation' | 'BoostPurchaseAuditMissing'
  Dimensions: Array<{ Name: string; Value: string }>
}

/** @deprecated Use `BoostMetricInput`. Kept as an alias for backwards compatibility. */
export type BoostFloorViolationMetricInput = BoostMetricInput

export type PutMetricFn = (input: BoostMetricInput) => Promise<void> | void

export type BoostFloorDecision = { decision: 'accept' } | { decision: 'reject'; code: 'BOOST_BELOW_FLOOR' }

/**
 * Booster floor check + metric-emission contract.
 *
 * This is the unit of behaviour task 3.3 will reuse when wiring `purchaseBoost`
 * to the floor enforcement path. Today (task 3.2) it is exercised only by the
 * property test in `__tests__/floor-check.property.test.ts`.
 *
 * Contract:
 *  - Returns the same decision shape as `checkBoostFloor`.
 *  - On `reject`, issues exactly one `BoostFloorViolation` `putMetric` call with
 *    dimensions `{ duration, businessId }`.
 *  - On `accept`, makes zero `putMetric` calls.
 *  - If `putMetric` itself throws, the error is swallowed (logged to `console.warn`
 *    in production; tests assert the throw does not propagate). The rejection
 *    decision is returned regardless of whether metric emission succeeded — per
 *    R9.5, the rejection MUST NOT be conditional on metric emission.
 *
 * Validates: Requirements 3.3, 3.4, 9.5, 10.1
 */
export async function decideBoostFloorWithMetric(
  computedPriceCents: number,
  floorCents: number,
  duration: BoostDuration,
  businessId: string,
  putMetric: PutMetricFn,
): Promise<BoostFloorDecision> {
  const decision = checkBoostFloor(computedPriceCents, floorCents)

  if (decision.decision === 'reject') {
    try {
      await putMetric({
        MetricName: 'BoostFloorViolation',
        Dimensions: [
          { Name: 'duration', Value: duration },
          { Name: 'businessId', Value: businessId },
        ],
      })
    } catch (err) {
      // R9.5: rejection MUST NOT be conditional on metric emission succeeding.
      // Swallow and continue so the caller still receives the reject decision.
      // eslint-disable-next-line no-console
      console.warn('[boost-floor] BoostFloorViolation metric emission failed', err)
    }
  }

  return decision
}
