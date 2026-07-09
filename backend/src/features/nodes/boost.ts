/**
 * Boost_Window read model (billing R5.2, R5.5).
 *
 * A node is Boost_Active while its paid Boost_Window (`boostUntil`) is still in
 * the future. This is computed purely at read time from the stored instant:
 * there is no expiry worker, so once the window passes `boostActive` reverts to
 * false on the next read with no residue.
 *
 * A boost is a PAID reach signal and is kept strictly separate from
 * pulse/aliveness (honest-presence): it never feeds the live presence count or
 * beam brightness. Ranking may only consume it inside the level-3 tier signal
 * (discovery-dna-vibe-over-convenience).
 *
 * `boostUntil` is an ISO 8601 ms UTC string (as written by `setNodeBoostWindow`).
 * An absent/null/unparseable value reads as not-boosted.
 */
export function isBoostActive(boostUntil: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!boostUntil) return false
  const end = Date.parse(boostUntil)
  return Number.isFinite(end) && end > nowMs
}
