/**
 * Digest_Email renderer on the shared SES module (weekly-attribution-digest
 * R4.2, R4.3, R4.4).
 *
 * `sendDigestEmail` is a renderer: it takes the already-built copy lines (the
 * single source of truth shared with the dashboard card, R4.3) plus the venue
 * name and headline visit count, and emits one SESv2 Simple-content email.
 * These tests mock the SESv2 client to capture the SendEmailCommand input and
 * assert:
 *   - the subject states the venue name and the headline count (R4.3);
 *   - the Text and Html bodies render the copy lines in order;
 *   - dynamic values interpolated into the Html body are escaped;
 *   - no consumer PII leaks (only the venue name and aggregate counts render).
 *
 * Runs under the standard `pnpm test` (default node env).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Capture the SESv2 SendEmailCommand input ────────────────────────────────

const h = vi.hoisted(() => ({
  sendMock: vi.fn(async (..._args: unknown[]) => ({})),
}))

vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class {
    send = h.sendMock
  },
  SendEmailCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}))

import { sendDigestEmail } from '../ses.js'

interface SimpleContent {
  Subject: { Data: string }
  Body: { Text: { Data: string }; Html: { Data: string } }
}

function lastEmail(): { to: string; subject: string; text: string; html: string } {
  const cmd = h.sendMock.mock.calls.at(-1)![0] as unknown as { input: Record<string, unknown> }
  const input = cmd.input
  const destination = input['Destination'] as { ToAddresses: string[] }
  const simple = (input['Content'] as { Simple: SimpleContent }).Simple
  return {
    to: destination.ToAddresses[0]!,
    subject: simple.Subject.Data,
    text: simple.Body.Text.Data,
    html: simple.Body.Html.Data,
  }
}

const COPY_LINES = [
  '23 visits recorded through Area Code this week, up 3 from the previous week.',
  '18 unique visitors recorded.',
  'The full weekly report adds peak-hours analysis. Upgrade to unlock it.',
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sendDigestEmail subject (R4.3)', () => {
  it('states the venue name and the headline visit count', async () => {
    await sendDigestEmail('owner@venue.co.za', 'The Grand Cafe', 23, COPY_LINES)

    const { to, subject } = lastEmail()
    expect(to).toBe('owner@venue.co.za')
    expect(subject).toBe('The Grand Cafe: 23 visits recorded this week')
  })
})

describe('sendDigestEmail body renders the shared copy lines in order (R4.3)', () => {
  it('renders every copy line in the Text body in order', async () => {
    await sendDigestEmail('owner@venue.co.za', 'The Grand Cafe', 23, COPY_LINES)

    const { text } = lastEmail()
    for (const line of COPY_LINES) {
      expect(text).toContain(line)
    }
    // Order preserved: the first line appears before the last.
    expect(text.indexOf(COPY_LINES[0]!)).toBeLessThan(text.indexOf(COPY_LINES[2]!))
  })

  it('renders every copy line in the Html body in order', async () => {
    await sendDigestEmail('owner@venue.co.za', 'The Grand Cafe', 23, COPY_LINES)

    const { html } = lastEmail()
    for (const line of COPY_LINES) {
      expect(html).toContain(line)
    }
    expect(html.indexOf(COPY_LINES[0]!)).toBeLessThan(html.indexOf(COPY_LINES[2]!))
    // Venue name rendered in the Html heading.
    expect(html).toContain('The Grand Cafe')
  })
})

describe('sendDigestEmail escapes dynamic values in the Html body', () => {
  it('escapes HTML in the venue name', async () => {
    await sendDigestEmail('owner@venue.co.za', 'Bar & <Grill>', 5, COPY_LINES)

    const { html } = lastEmail()
    expect(html).toContain('Bar &amp; &lt;Grill&gt;')
    expect(html).not.toContain('<Grill>')
  })

  it('escapes HTML in a copy line', async () => {
    await sendDigestEmail('owner@venue.co.za', 'The Grand Cafe', 5, ['<script>alert(1)</script> recorded.'])

    const { html } = lastEmail()
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; recorded.')
    expect(html).not.toContain('<script>')
  })
})

describe('sendDigestEmail carries no consumer PII', () => {
  it('renders only the venue name and the provided copy lines', async () => {
    await sendDigestEmail('owner@venue.co.za', 'The Grand Cafe', 23, COPY_LINES)

    const { text, html } = lastEmail()
    // The renderer only ever emits the venue name, headline count, and the
    // copy lines it was handed — it never reaches for consumer identifiers.
    const body = `${text}\n${html}`
    expect(body).not.toMatch(/user-\w+/)
    expect(body).not.toContain('cognito')
  })
})
