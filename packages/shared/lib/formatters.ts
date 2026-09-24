export function formatZAR(amount: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatRelativeTime(dateString: string): string {
  const now = Date.now()
  const date = new Date(dateString).getTime()
  const diffMs = now - date
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`

  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(dateString))
}

// Date and time display lives in `./sast.ts`, the one home for SAST arithmetic
// and SAST-pinned formatting (`formatSastDate`, `formatSastTime`,
// `formatSastDateTime`). Do not add a second date formatter here.

export function formatCountdown(seconds: number): string {
  const min = Math.floor(seconds / 60)
  const sec = seconds % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

/** Convert local SA number (06x, 07x, 08x) to E.164 (+27...) */
export function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0') && digits.length === 10) {
    return `+27${digits.slice(1)}`
  }
  if (digits.startsWith('27') && digits.length === 11) {
    return `+${digits}`
  }
  return raw.startsWith('+') ? raw : `+${digits}`
}
