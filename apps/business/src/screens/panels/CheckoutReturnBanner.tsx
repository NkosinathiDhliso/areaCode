import type { ReactNode } from 'react'

import type { ReturnState } from './checkoutReturnState'

const SUPPORT_EMAIL = 'support@areacode.co.za'

interface CheckoutReturnBannerProps {
  state: ReturnState
  // Dismisses the banner. Shown on terminal, non-activating states.
  onDismiss: () => void
}

// Renders the truthful checkout-return message for each state (R6.1, R6.2,
// R6.3). `idle` and `activating`-with-no-copy cases render nothing extra beyond
// what this returns. The pure state machine lives in `checkoutReturnState.ts`.
export function CheckoutReturnBanner({ state, onDismiss }: CheckoutReturnBannerProps) {
  if (state === 'idle') return null

  if (state === 'activating') {
    return (
      <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3 flex flex-row items-center gap-3">
        <span className="w-4 h-4 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
        <span className="text-[var(--text-primary)] text-sm">
          Confirming your payment. This usually takes a few seconds.
        </span>
      </div>
    )
  }

  if (state === 'confirmed') {
    return (
      <Dismissible onDismiss={onDismiss} tone="success">
        <span className="text-[var(--text-primary)] text-sm font-medium">
          Payment confirmed. Your plan is now active.
        </span>
      </Dismissible>
    )
  }

  if (state === 'timeout') {
    return (
      <Dismissible onDismiss={onDismiss} tone="warning">
        <span className="text-[var(--text-primary)] text-sm">
          Your payment is still processing. If your plan does not update in a few minutes, contact{' '}
          <a className="underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>{' '}
          and we will sort it out.
        </span>
      </Dismissible>
    )
  }

  if (state === 'cancelled') {
    return (
      <Dismissible onDismiss={onDismiss} tone="neutral">
        <span className="text-[var(--text-secondary)] text-sm">Checkout cancelled. No payment was taken.</span>
      </Dismissible>
    )
  }

  // failed
  return (
    <Dismissible onDismiss={onDismiss} tone="neutral">
      <span className="text-[var(--text-secondary)] text-sm">
        That payment did not go through and no charge was made. You can try again when you are ready.
      </span>
    </Dismissible>
  )
}

type Tone = 'success' | 'warning' | 'neutral'

const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-[var(--success-subtle,#e7f7ee)] border-[var(--success)]',
  warning: 'bg-[var(--warning-subtle,#fdf1e7)] border-[var(--warning)]',
  neutral: 'bg-[var(--bg-raised)] border-[var(--border)]',
}

function Dismissible({ children, onDismiss, tone }: { children: ReactNode; onDismiss: () => void; tone: Tone }) {
  return (
    <div
      className={`border rounded-2xl px-4 py-3 flex flex-row items-start justify-between gap-3 ${TONE_CLASSES[tone]}`}
    >
      <div className="flex-1">{children}</div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-[var(--text-muted)] text-sm shrink-0 w-6 h-6 flex items-center justify-center active:scale-95"
      >
        &times;
      </button>
    </div>
  )
}
