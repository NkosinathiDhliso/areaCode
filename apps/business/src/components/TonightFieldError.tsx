import type { TonightError, TonightField } from '../lib/tonightSlot'

/**
 * Inline error for one Tonight control (proof-of-demand R8.3). One error is
 * shown at a time because the validator reports the first rule that failed,
 * and guessing at the rest would invent problems the API has not named.
 */
export function TonightFieldError({ field, error }: { field: TonightField; error: TonightError | null }) {
  if (!error || error.field !== field) return null
  return (
    <span data-testid={`tonight-error-${field}`} className="text-[var(--danger)] text-xs" role="alert">
      {error.message}
    </span>
  )
}
