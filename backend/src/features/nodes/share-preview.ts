/**
 * Share_Preview document — the HTML served for `/node/{slug}`
 * (proof-of-demand R1.2, R12.2, R12.3).
 *
 * Pure: no clock, no I/O, no env reads. The service resolves the venue and
 * hands this function a finished view model, so the document is unit-testable
 * without a database.
 *
 * The page has two audiences and serves both from one response:
 *
 * - Link crawlers (WhatsApp, iMessage, Slack, Facebook) read the Open Graph
 *   tags with JavaScript disabled. They must see the venue name, the live
 *   snapshot line and an image without executing anything.
 * - Real visitors get redirected into the app at
 *   `/map?venue={slug}&src=share`, where the consumer app lands them on the
 *   venue card in Browse_Mode (task 1.6). A `<noscript>` link carries the same
 *   destination for script-less clients.
 *
 * Security: every interpolated value is escaped for its position. The venue
 * name and the snapshot line are owner/consumer-influenced text and go through
 * `escapeHtml`; the slug reaches the inline script only as a JSON string
 * literal with `<` neutralised, and it is already validated against the slug
 * shape at the route boundary. The inline redirect runs under a per-response
 * nonce, so the document CSP needs neither `unsafe-inline` nor a relaxed
 * `default-src`.
 */

import { escapeHtml } from '../../shared/html/escape.js'
import { venueArrivalPath } from '../../shared/links/venue-arrival.js'

/**
 * Site default OG image, used when the venue has no header image. Same asset
 * the consumer app's `index.html` points at, on the `www` host that serves it.
 * This is the designed "no venue photo" state required by R1.2, not a masking
 * fallback: a share card without an image reads as broken.
 */
export const DEFAULT_OG_IMAGE = 'https://www.areacode.co.za/og-image.png'

/**
 * Crawler and browser cache window for the preview (R1.2 / task 1.3). Five
 * minutes: long enough to absorb a share burst on one link, short enough that
 * the snapshot line still reads as a moment. WhatsApp snapshots the card at
 * share time anyway, so a longer window would only stale the in-browser hit.
 */
export const SHARE_PREVIEW_CACHE_CONTROL = 'public, max-age=300'

/** Document CSP for this page: nothing loads, only the nonced redirect runs. */
export function sharePreviewCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export interface SharePreviewView {
  /** Venue slug, already validated against the slug shape. */
  slug: string
  /** Venue name — `<title>`, `og:title` (R1.2). */
  name: string
  /** Live snapshot line from `buildShareSnapshot` — `og:description` (R1.2). */
  description: string
  /** Venue header image URL, or the site default (R1.2). */
  imageUrl: string
  /** `og:url` / canonical: the consumer-domain venue link that was shared. */
  canonicalUrl: string
}

/**
 * Render the Share_Preview document.
 *
 * @param view   resolved venue view model
 * @param nonce  per-response CSP nonce for the inline redirect; must match the
 *               `script-src` nonce in {@link sharePreviewCsp}
 */
export function renderSharePreview(view: SharePreviewView, nonce: string): string {
  const name = escapeHtml(view.name)
  const description = escapeHtml(view.description)
  const image = escapeHtml(view.imageUrl)
  const canonical = escapeHtml(view.canonicalUrl)
  const target = venueArrivalPath(view.slug, 'share')
  // Attribute position: `&` in the query string must be an entity.
  const targetHref = escapeHtml(target)
  // Script position: a JSON string literal with `<` neutralised so the value
  // can never close the script element, whatever a future slug shape allows.
  const targetJs = JSON.stringify(target).replace(/</g, '\\u003c')
  const nonceAttr = escapeHtml(nonce)

  return `<!doctype html>
<html lang="en-ZA">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}</title>
<meta name="description" content="${description}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Area Code" />
<meta property="og:locale" content="en_ZA" />
<meta property="og:title" content="${name}" />
<meta property="og:description" content="${description}" />
<meta property="og:image" content="${image}" />
<meta property="og:url" content="${canonical}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${name}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${image}" />
<script nonce="${nonceAttr}">location.replace(${targetJs})</script>
</head>
<body>
<noscript>
<h1>${name}</h1>
<p>${description}</p>
<p><a href="${targetHref}">Open ${name} on Area Code</a></p>
</noscript>
</body>
</html>
`
}
