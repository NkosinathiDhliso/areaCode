/**
 * Unit tests for the Share_Preview document renderer (proof-of-demand R1.2,
 * R12.3). `renderSharePreview` is pure, so these assert the exact contract a
 * link crawler and a browser depend on:
 *
 *  - Open Graph title / description / image / url are present and carry the
 *    values the service resolved
 *  - every interpolated value is escaped for its position, so a venue name
 *    cannot inject markup or script into the page
 *  - script-capable clients are redirected to `/map?venue={slug}&src=share`
 *    and a `<noscript>` link points at the same destination
 *
 * _Requirements: 1.2, 12.2, 12.3_
 */

import { describe, expect, it } from 'vitest'

import { venueArrivalPath } from '../../../shared/links/venue-arrival.js'
import {
  DEFAULT_OG_IMAGE,
  renderSharePreview,
  sharePreviewCsp,
  SHARE_PREVIEW_CACHE_CONTROL,
  type SharePreviewView,
} from '../share-preview.js'

const NONCE = 'dGVzdC1ub25jZQ=='

function view(overrides: Partial<SharePreviewView> = {}): SharePreviewView {
  return {
    slug: 'ramonas-a1b2c3',
    name: "Ramona's",
    description: "Ramona's \u00b7 Buzzing \u00b7 12 here now",
    imageUrl: 'https://cdn.areacode.co.za/nodes/n1/header.webp',
    canonicalUrl: 'https://areacode.co.za/node/ramonas-a1b2c3',
    ...overrides,
  }
}

/** Pull a meta tag's content by property/name, as a crawler would. */
function metaContent(html: string, attr: 'property' | 'name', key: string): string | null {
  const match = new RegExp(`<meta ${attr}="${key}" content="([^"]*)" />`).exec(html)
  return match ? (match[1] ?? null) : null
}

describe('renderSharePreview — Open Graph tags (R1.2)', () => {
  it('carries title, description, image and url', () => {
    const v = view()
    const html = renderSharePreview(v, NONCE)

    expect(metaContent(html, 'property', 'og:title')).toBe('Ramona&#39;s')
    expect(metaContent(html, 'property', 'og:description')).toBe('Ramona&#39;s \u00b7 Buzzing \u00b7 12 here now')
    expect(metaContent(html, 'property', 'og:image')).toBe(v.imageUrl)
    expect(metaContent(html, 'property', 'og:url')).toBe(v.canonicalUrl)
    expect(html).toContain(`<title>Ramona&#39;s</title>`)
    expect(html).toContain(`<link rel="canonical" href="${v.canonicalUrl}" />`)
  })

  it('renders the site default image when that is what the service resolved', () => {
    const html = renderSharePreview(view({ imageUrl: DEFAULT_OG_IMAGE }), NONCE)
    expect(metaContent(html, 'property', 'og:image')).toBe('https://www.areacode.co.za/og-image.png')
  })

  it('needs no JavaScript for the tags: they are all in the served head', () => {
    const html = renderSharePreview(view(), NONCE)
    const head = html.slice(0, html.indexOf('</head>'))
    for (const key of ['og:title', 'og:description', 'og:image', 'og:url']) {
      expect(head).toContain(`property="${key}"`)
    }
  })
})

describe('renderSharePreview — redirect and noscript (R12.3)', () => {
  it('redirects script-capable clients to the map with the share source', () => {
    const html = renderSharePreview(view(), NONCE)
    expect(html).toContain(`<script nonce="${NONCE}">location.replace("/map?venue=ramonas-a1b2c3&src=share")</script>`)
  })

  it('offers the same destination as a noscript link, with the query escaped', () => {
    const html = renderSharePreview(view(), NONCE)
    const noscript = html.slice(html.indexOf('<noscript>'))
    expect(noscript).toContain('<a href="/map?venue=ramonas-a1b2c3&amp;src=share">')
  })

  it('builds the target path from the slug', () => {
    expect(venueArrivalPath('father-coffee-9z8y7x', 'share')).toBe('/map?venue=father-coffee-9z8y7x&src=share')
  })
})

describe('renderSharePreview — escaping (security)', () => {
  const hostile = `Bob's "Bar" <script>alert(1)</script>`

  it('escapes the venue name in element text and attribute positions', () => {
    const html = renderSharePreview(view({ name: hostile, description: hostile }), NONCE)

    // No raw markup survives anywhere in the document.
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('"Bar"')
    expect(metaContent(html, 'property', 'og:title')).toBe(
      'Bob&#39;s &quot;Bar&quot; &lt;script&gt;alert(1)&lt;/script&gt;',
    )
    expect(html).toContain('<h1>Bob&#39;s &quot;Bar&quot; &lt;script&gt;alert(1)&lt;/script&gt;</h1>')
  })

  it('keeps the only script element the one nonced redirect', () => {
    const html = renderSharePreview(view({ name: hostile, description: hostile }), NONCE)
    expect(html.match(/<script/g)).toHaveLength(1)
    expect(html.match(/<\/script>/g)).toHaveLength(1)
  })

  it('never emits a raw quote or angle bracket from a resolved URL', () => {
    const html = renderSharePreview(
      view({ imageUrl: 'https://cdn.example.com/a"onerror="x', canonicalUrl: 'https://areacode.co.za/node/a"b' }),
      NONCE,
    )
    expect(html).toContain('content="https://cdn.example.com/a&quot;onerror=&quot;x"')
    expect(html).toContain('href="https://areacode.co.za/node/a&quot;b"')
  })
})

describe('share preview response policy', () => {
  it('caches publicly for five minutes (task 1.3)', () => {
    expect(SHARE_PREVIEW_CACHE_CONTROL).toBe('public, max-age=300')
  })

  it('allows only the nonced inline script, nothing else', () => {
    const csp = sharePreviewCsp(NONCE)
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain(`script-src 'nonce-${NONCE}'`)
    expect(csp).not.toContain('unsafe-inline')
  })
})
