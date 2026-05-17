import type { BusinessTier } from '../types'

/**
 * Glyph size multiplier per business tier. Higher-tier businesses get
 * physically larger markers on the map — this is the "paid lever" (R8.1).
 *
 * The halo radius scales proportionally (bigger venue = bigger halo) but
 * halo brightness and animation speed stay locked to pulse score only —
 * tier cannot buy halo intensity (R8.5, the "honest lever").
 */
export const TIER_SIZE_MULTIPLIER: Record<BusinessTier, number> = {
  free: 1.0,
  starter: 1.0,
  payg: 1.0,
  growth: 1.3,
  pro: 1.6,
}
