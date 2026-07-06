/**
 * Share card generator - client-side canvas rendering (R14.4: no Lambda).
 *
 * `buildShareCardData` is pure: it distils only the generating consumer's own
 * stats into the card payload. This is the Property 9 (Share Card Privacy)
 * target - it must never copy a foreign user's id/name/avatar/history into its
 * output, even when such data is available in the calling scope.
 *
 * `generateShareCard` renders from its output into an HTML5 Canvas and returns
 * a PNG Blob suitable for the Web Share API.
 */

import { getArchetypeDisplayName, getTierLabel } from '@area-code/shared/constants'
import type { Tier } from '@area-code/shared/types'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Input from the consumer's own profile/stats. May contain more fields than
 * needed - `buildShareCardData` distils only the safe subset.
 */
export interface ConsumerStats {
  rank: number
  archetypeId: string | null
  tier: Tier
  weeklyCheckInCount: number
  topVenueName: string | null
  /** Consumer's own display name (shown on card). */
  displayName?: string
}

/**
 * The pure, minimal payload rendered onto the share card.
 * Contains ONLY the generating consumer's own data (Property 9).
 */
export interface ShareCardData {
  rank: number
  archetypeId: string | null
  archetypeName: string
  archetypeGlyph: string
  tier: Tier
  tierLabel: string
  weeklyCheckInCount: number
  topVenueName: string | null
  displayName: string | null
}

// ─── Archetype glyph mapping (Unicode stand-ins for canvas rendering) ────────

/** Unicode glyphs used on the canvas card to represent each archetype visually. */
const ARCHETYPE_GLYPHS: Record<string, string> = {
  'archetype-festival-spirit': '🔥',
  'archetype-conscious-creative': '✨',
  'archetype-township-royal': '👑',
  'archetype-sacred-rebel': '🙏',
  'archetype-firecracker': '⚡',
  'archetype-heritage-groover': '🎵',
  'archetype-midnight-philosopher': '🌙',
  'archetype-street-poet': '🎤',
  'archetype-soul-wanderer': '🌀',
  'archetype-vibe-architect': '🎛️',
  'archetype-smooth-operator': '🎶',
  'archetype-groove-seeker': '👟',
  'archetype-culture-curator': '🌳',
  'archetype-eclectic': '💿',
  'archetype-uncharted': '🧭',
}

const DEFAULT_GLYPH = '💿'

/** Tier colours (resolved hex values for canvas - cannot use CSS vars). */
const TIER_COLOURS: Record<Tier, string> = {
  local: '#94a3b8',
  regular: '#60a5fa',
  fixture: '#a78bfa',
  institution: '#f59e0b',
  legend: '#ef4444',
}

// ─── Pure data builder (Property 9 target) ───────────────────────────────────

/**
 * Distils only the generating consumer's own stats into the card payload.
 *
 * This function is intentionally minimal and takes a single `ConsumerStats`
 * object - it never accepts other users' data as input, making it structurally
 * impossible for foreign PII to leak into the output.
 */
export function buildShareCardData(stats: ConsumerStats): ShareCardData {
  const archetypeName = stats.archetypeId ? getArchetypeDisplayName(stats.archetypeId) : 'Explorer'

  const archetypeGlyph = stats.archetypeId ? (ARCHETYPE_GLYPHS[stats.archetypeId] ?? DEFAULT_GLYPH) : DEFAULT_GLYPH

  return {
    rank: stats.rank,
    archetypeId: stats.archetypeId,
    archetypeName,
    archetypeGlyph,
    tier: stats.tier,
    tierLabel: getTierLabel(stats.tier),
    weeklyCheckInCount: stats.weeklyCheckInCount,
    topVenueName: stats.topVenueName,
    displayName: stats.displayName ?? null,
  }
}

// ─── Canvas renderer ─────────────────────────────────────────────────────────

/** Card dimensions optimised for Instagram/WhatsApp stories (9:16 portrait). */
const CARD_WIDTH = 540
const CARD_HEIGHT = 960

/**
 * Renders a share card from `ShareCardData` using HTML5 Canvas.
 * Returns a PNG Blob suitable for the Web Share API.
 *
 * Design: dark gradient background, branded layout with rank prominently
 * displayed, archetype glyph + name, tier badge, weekly count, and top venue.
 */
export async function generateShareCard(data: ShareCardData): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')!

  // ─── Background gradient ──────────────────────────────────────────────
  const gradient = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT)
  gradient.addColorStop(0, '#0f172a') // slate-900
  gradient.addColorStop(0.5, '#1e1b4b') // indigo-950
  gradient.addColorStop(1, '#0f172a') // slate-900
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  // ─── Decorative accent arc ────────────────────────────────────────────
  ctx.beginPath()
  ctx.arc(CARD_WIDTH / 2, 180, 200, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(99, 102, 241, 0.08)' // indigo glow
  ctx.fill()

  // ─── Brand header ─────────────────────────────────────────────────────
  ctx.fillStyle = '#94a3b8'
  ctx.font = '500 16px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('AREA CODE', CARD_WIDTH / 2, 60)

  // ─── Archetype glyph (large) ──────────────────────────────────────────
  ctx.font = '72px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(data.archetypeGlyph, CARD_WIDTH / 2, 180)

  // ─── Archetype name ───────────────────────────────────────────────────
  ctx.fillStyle = '#e2e8f0'
  ctx.font = '600 28px system-ui, -apple-system, sans-serif'
  ctx.fillText(data.archetypeName, CARD_WIDTH / 2, 230)

  // ─── Rank (hero element) ──────────────────────────────────────────────
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 96px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`#${data.rank}`, CARD_WIDTH / 2, 370)

  // Rank subtitle
  ctx.fillStyle = '#94a3b8'
  ctx.font = '400 20px system-ui, -apple-system, sans-serif'
  ctx.fillText('This Week', CARD_WIDTH / 2, 405)

  // ─── Tier badge ───────────────────────────────────────────────────────
  const tierColour = TIER_COLOURS[data.tier]
  const tierText = data.tierLabel
  const tierY = 470

  // Badge background (rounded rect)
  const tierMetrics = ctx.measureText(tierText)
  const badgePadX = 20
  const badgePadY = 8
  const badgeW = tierMetrics.width + badgePadX * 2
  const badgeH = 36
  const badgeX = (CARD_WIDTH - badgeW) / 2

  ctx.fillStyle = tierColour
  ctx.globalAlpha = 0.2
  roundRect(ctx, badgeX, tierY - badgeH / 2 - badgePadY, badgeW, badgeH + badgePadY * 2, 18)
  ctx.fill()
  ctx.globalAlpha = 1

  // Badge border
  ctx.strokeStyle = tierColour
  ctx.lineWidth = 2
  roundRect(ctx, badgeX, tierY - badgeH / 2 - badgePadY, badgeW, badgeH + badgePadY * 2, 18)
  ctx.stroke()

  // Badge text
  ctx.fillStyle = tierColour
  ctx.font = '600 22px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(tierText, CARD_WIDTH / 2, tierY + 8)

  // ─── Stats section ────────────────────────────────────────────────────
  const statsY = 580

  // Weekly check-in count
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 48px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`${data.weeklyCheckInCount}`, CARD_WIDTH / 2, statsY)

  ctx.fillStyle = '#94a3b8'
  ctx.font = '400 18px system-ui, -apple-system, sans-serif'
  ctx.fillText('check-ins this week', CARD_WIDTH / 2, statsY + 30)

  // ─── Top venue ────────────────────────────────────────────────────────
  if (data.topVenueName) {
    const venueY = 680
    ctx.fillStyle = '#64748b'
    ctx.font = '400 16px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Powered by', CARD_WIDTH / 2, venueY)

    ctx.fillStyle = '#e2e8f0'
    ctx.font = '600 24px system-ui, -apple-system, sans-serif'
    ctx.fillText(truncateText(ctx, data.topVenueName, CARD_WIDTH - 80), CARD_WIDTH / 2, venueY + 35)
  }

  // ─── Display name (if present) ────────────────────────────────────────
  if (data.displayName) {
    ctx.fillStyle = '#cbd5e1'
    ctx.font = '500 20px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(data.displayName, CARD_WIDTH / 2, 800)
  }

  // ─── Footer / CTA ────────────────────────────────────────────────────
  ctx.fillStyle = '#475569'
  ctx.font = '400 14px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('See where the city comes alive', CARD_WIDTH / 2, CARD_HEIGHT - 50)

  // ─── Export as PNG Blob ───────────────────────────────────────────────
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Canvas toBlob returned null'))
    }, 'image/png')
  })
}

/**
 * Render a milestone share card (e.g. "7-day streak", "Moved up to Patron").
 * Reuses the branded canvas layout. Contains only the milestone text, so it
 * exposes no other user's data (R11.5.3).
 */
export async function generateMilestoneCard(title: string, body: string): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')!

  const gradient = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT)
  gradient.addColorStop(0, '#0f172a')
  gradient.addColorStop(0.5, '#1e1b4b')
  gradient.addColorStop(1, '#0f172a')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#94a3b8'
  ctx.font = '500 16px system-ui, -apple-system, sans-serif'
  ctx.fillText('AREA CODE', CARD_WIDTH / 2, 80)

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 52px system-ui, -apple-system, sans-serif'
  ctx.fillText(truncateText(ctx, title, CARD_WIDTH - 80), CARD_WIDTH / 2, CARD_HEIGHT / 2 - 20)

  ctx.fillStyle = '#cbd5e1'
  ctx.font = '400 24px system-ui, -apple-system, sans-serif'
  ctx.fillText(truncateText(ctx, body, CARD_WIDTH - 80), CARD_WIDTH / 2, CARD_HEIGHT / 2 + 30)

  ctx.fillStyle = '#475569'
  ctx.font = '400 14px system-ui, -apple-system, sans-serif'
  ctx.fillText('See where the city comes alive', CARD_WIDTH / 2, CARD_HEIGHT - 50)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob returned null'))), 'image/png')
  })
}

// ─── Share / copy (Web Share API with clipboard fallback) ───────────────────

/**
 * Deep link included in every share so external viewers can discover Area Code.
 * Points at the live web app, which prompts install on unsupported platforms
 * (R12.3, R14.2). Override via `VITE_APP_SHARE_URL` per environment.
 */
export const APP_SHARE_URL = (import.meta.env?.['VITE_APP_SHARE_URL'] as string | undefined) ?? 'https://areacode.co.za'

/**
 * Share a generated card via the Web Share API when available, falling back to
 * copying a text summary + deep link to the clipboard.
 *
 * The image file is only attached when the platform reports it can share files
 * (`navigator.canShare`), otherwise we share text + url so the call never
 * rejects on unsupported file payloads. Any failure (including the user
 * dismissing the sheet) degrades to the clipboard path.
 *
 * Requirements: 10.3.3, 10.3.4, 11.5.4, 12.3
 */
export async function shareOrCopy(blob: Blob, text: string, url: string = APP_SHARE_URL): Promise<void> {
  const file = new File([blob], 'area-code.png', { type: 'image/png' })
  const nav = typeof navigator !== 'undefined' ? navigator : undefined

  if (nav?.share) {
    const canShareFiles = typeof nav.canShare === 'function' && nav.canShare({ files: [file] })
    try {
      await nav.share(canShareFiles ? { text, url, files: [file] } : { text, url })
      return
    } catch (err) {
      // AbortError = user dismissed the sheet; do not fall through to clipboard.
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Any other failure falls through to the clipboard path below.
    }
  }

  if (nav?.clipboard?.writeText) {
    await nav.clipboard.writeText(`${text}\n${url}`)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Draw a rounded rectangle path (does not fill/stroke - caller does that). */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/** Truncate text with ellipsis if it exceeds maxWidth. */
function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let truncated = text
  while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1)
  }
  return truncated + '…'
}
