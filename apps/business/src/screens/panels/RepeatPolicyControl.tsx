import type { RepeatPolicy } from '@area-code/shared/types'

/**
 * Repeat_Policy control for loyalty nth_checkin gets (R6.1, R6.2, R6.4).
 *
 * Two mutually exclusive options: "One per customer" (`once`, the default) and
 * a repeat option whose copy states the exact behaviour, including the 4-hour
 * gate, so the operator is never surprised by what the get costs. The control
 * is rendered ONLY for loyalty nth_checkin gets; the parent form hides it for
 * event/offer categories and non-nth loyalty types (R6.4).
 *
 * When a slot cap is set on a `per_visit` get, an extra line states that slots
 * count total redemptions including repeats, not distinct customers (R6.2). No
 * copy implies unlimited free redemptions (R6.4).
 */
const OPTIONS: readonly { value: RepeatPolicy; label: string; hint: string }[] = [
  {
    value: 'once',
    label: 'One per customer',
    hint: 'Each customer can earn and redeem this a single time.',
  },
  {
    value: 'per_visit',
    label: 'Repeats each visit',
    hint: 'Regulars can earn this again each visit, at least 4 hours after their last redemption.',
  },
]

export function RepeatPolicyControl({
  value,
  onChange,
  disabled,
  slotsSet,
}: {
  value: RepeatPolicy
  onChange: (value: RepeatPolicy) => void
  disabled: boolean
  slotsSet: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[var(--text-secondary)] text-[11px]">How often can customers earn this?</span>
      <div role="radiogroup" aria-label="Repeat policy" className="flex flex-col gap-2">
        {OPTIONS.map((option) => {
          const selected = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`flex flex-col items-start gap-0.5 text-left rounded-xl px-4 py-3 min-h-[44px] border active:scale-95 disabled:opacity-50 ${
                selected
                  ? 'border-[var(--accent)] bg-[var(--bg-raised)]'
                  : 'border-[var(--border)] bg-[var(--bg-raised)]'
              }`}
            >
              <span className="text-[var(--text-primary)] text-sm font-medium">{option.label}</span>
              <span className="text-[var(--text-muted)] text-[11px]">{option.hint}</span>
            </button>
          )
        })}
      </div>
      {value === 'per_visit' && slotsSet && (
        <p className="text-[var(--text-muted)] text-[11px]">
          Slots count total redemptions including repeats, not distinct customers.
        </p>
      )}
    </div>
  )
}
