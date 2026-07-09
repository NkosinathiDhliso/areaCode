import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

import { AWS_REGION } from '../config/env.js'

const ses = new SESv2Client({ region: AWS_REGION })
const FROM_EMAIL = process.env['AREA_CODE_FROM_EMAIL'] ?? 'noreply@areacode.co.za'

export async function sendPasswordResetEmail(to: string, code: string) {
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: 'Reset your Area Code password' },
          Body: {
            Text: {
              Data: `Your password reset code is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, ignore this email.`,
            },
            Html: {
              Data: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px"><h2 style="color:#333">Reset your password</h2><p>Your code is:</p><p style="font-size:32px;font-weight:bold;letter-spacing:4px;color:#6366f1">${code}</p><p style="color:#666;font-size:14px">This code expires in 10 minutes. If you didn't request this, ignore this email.</p></div>`,
            },
          },
        },
      },
    }),
  )
}

export async function sendTrialExpiryEmail(to: string, businessName: string, daysLeft: number) {
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: `Your Area Code trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` },
          Body: {
            Text: {
              Data: `Hi ${businessName},\n\nYour free trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Subscribe to keep your Growth/Pro features.\n\nVisit your Plans panel to choose a plan.`,
            },
          },
        },
      },
    }),
  )
}

/**
 * Renewal-reminder email (billing-revenue-integrity R3.1).
 *
 * Sent by the Lapse_Sweep when a paid subscription window has lapsed and the
 * business has just entered the 7-day renewal grace window. One send per lapse
 * (the sweep sets `paymentGraceUntil` first, which removes the business from
 * the next run's selection, so this fires exactly once per lapse). Transactional,
 * email-only, no SMS or phone path (no-sms-no-phone-auth.md). Follows the
 * `sendTrialExpiryEmail` shape.
 */
export async function sendRenewalReminderEmail(to: string, businessName: string) {
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: 'Your Area Code subscription has lapsed' },
          Body: {
            Text: {
              Data: `Hi ${businessName},\n\nYour Area Code subscription has lapsed. You have 7 days to renew before your venues come off the map and your plan drops to starter.\n\nVisit your Plans panel to renew and keep your Growth/Pro features.`,
            },
          },
        },
      },
    }),
  )
}

/**
 * Pre-lapse renewal reminder (billing-revenue-integrity R3.4).
 *
 * Sent by the trial-reminder worker's renewal sweep when a paid monthly/yearly
 * subscription window will lapse within 7 days, so the owner can renew (a manual
 * re-checkout — there is no card vault) before their venues come off the map.
 *
 * Deliberately distinct from `sendRenewalReminderEmail`, which is the post-lapse
 * grace notice: this message is honest that the window is still active ("expires
 * in N days"), where the other says the subscription "has lapsed". Same message
 * for both copies would be a lie in one of the two states. Transactional,
 * email-only, no SMS or phone path (no-sms-no-phone-auth.md). Follows the
 * `sendTrialExpiryEmail` shape.
 */
export async function sendRenewalUpcomingEmail(to: string, businessName: string, daysLeft: number) {
  const dayWord = daysLeft === 1 ? 'day' : 'days'
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: `Your Area Code subscription renews in ${daysLeft} ${dayWord}` },
          Body: {
            Text: {
              Data: `Hi ${businessName},\n\nYour Area Code subscription expires in ${daysLeft} ${dayWord}. Renew from your Plans panel to keep your Growth/Pro features and keep your venues on the map.`,
            },
          },
        },
      },
    }),
  )
}

/**
 * Sends a promotional win-back campaign email on behalf of a business.
 *
 * Unlike the transactional senders above, this is marketing email, so it MUST
 * carry a working unsubscribe affordance (POPIA / Requirement 12.2):
 *   - a `List-Unsubscribe` header (plus `List-Unsubscribe-Post` for one-click
 *     unsubscribe per RFC 8058), added via the SESv2 Simple-content `Headers`
 *     field, and
 *   - a visible unsubscribe link in both the text and HTML bodies.
 *
 * Email-only delivery — there is no phone/SMS path here (Constraint C1).
 */
export async function sendCampaignEmail(
  to: string,
  businessName: string,
  subject: string,
  bodyText: string,
  unsubscribeUrl: string,
): Promise<void> {
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Headers: [
            { Name: 'List-Unsubscribe', Value: `<${unsubscribeUrl}>` },
            { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
          ],
          Subject: { Data: subject },
          Body: {
            Text: {
              Data: `${bodyText}\n\n---\nYou're receiving this because you've visited ${businessName}.\nUnsubscribe: ${unsubscribeUrl}`,
            },
            Html: {
              Data: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px"><p style="color:#333;font-size:16px;line-height:1.5;white-space:pre-wrap">${escapeHtml(bodyText)}</p><hr style="border:none;border-top:1px solid #eee;margin:24px 0"><p style="color:#999;font-size:12px">You're receiving this because you've visited ${escapeHtml(businessName)}. <a href="${unsubscribeUrl}" style="color:#6366f1">Unsubscribe</a>.</p></div>`,
            },
          },
        },
      },
    }),
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Report-ready notification (billing-revenue-integrity R9.1).
 *
 * Sent by the report generator when a weekly or monthly venue intelligence
 * report has been persisted, replacing the consumer-less `push-sender` SQS
 * enqueue. Delivery is best-effort: the generator wraps this in its own
 * try/catch so a send failure is logged and never aborts report persistence
 * (R9.3). Transactional, email-only, no SMS or phone path
 * (no-sms-no-phone-auth.md). Follows the `sendTrialExpiryEmail` shape.
 */
export async function sendReportReadyEmail(
  to: string,
  businessName: string,
  reportId: string,
  periodType: string,
): Promise<void> {
  const reportsUrl = `${businessPortalBaseUrl()}/reports`
  const periodLabel = periodType === 'monthly' ? 'monthly' : 'weekly'
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: 'Your Area Code report is ready' },
          Body: {
            Text: {
              Data: `Hi ${businessName},\n\nYour ${periodLabel} Area Code intelligence report is ready.\n\nOpen the Reports panel to see your latest crowd insights:\n${reportsUrl}\n\nReport reference: ${reportId}`,
            },
            Html: {
              Data: `<div style="font-family:sans-serif;max-width:440px;margin:0 auto;padding:24px"><h2 style="color:#333">Your report is ready</h2><p style="color:#444;font-size:15px;line-height:1.5">Hi ${escapeHtml(businessName)}, your ${periodLabel} Area Code intelligence report is ready with your latest crowd insights.</p><p style="margin:24px 0"><a href="${escapeHtml(reportsUrl)}" style="background:#6366f1;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block">Open Reports</a></p><p style="color:#999;font-size:12px;margin-top:24px">Report reference: ${escapeHtml(reportId)}</p></div>`,
            },
          },
        },
      },
    }),
  )
}

/**
 * Weekly Attribution Digest email (weekly-attribution-digest R4.2, R4.3, R4.4).
 *
 * Renderer only. The copy strings are the single source of truth built by
 * `buildDigestCopy` in the reports feature and shared with the dashboard card
 * (R4.3), so this sender never re-derives copy: it takes the already-built,
 * ordered `copyLines` plus the venue name and the headline visit count for the
 * subject. Body (Text and Html) renders those lines in order; every dynamic
 * value interpolated into the Html body is escaped via `escapeHtml`.
 *
 * No consumer PII: the payload behind these strings is PII-scanned before
 * persistence (R1.6), and only the venue name and aggregate counts reach here.
 * Transactional, email-only, no SMS or phone path (no-sms-no-phone-auth.md).
 * Follows the `sendReportReadyEmail` shape. The generator wraps this in its own
 * try/catch so a send failure is logged and the Digest_Row is retained (R4.4).
 */
export async function sendDigestEmail(
  to: string,
  venueName: string,
  headlineVisits: number,
  copyLines: string[],
): Promise<void> {
  const subject = `${venueName}: ${headlineVisits} visits recorded this week`
  const text = copyLines.join('\n\n')
  const htmlLines = copyLines
    .map((line) => `<p style="color:#444;font-size:15px;line-height:1.5;margin:0 0 12px">${escapeHtml(line)}</p>`)
    .join('')
  const html =
    `<div style="font-family:sans-serif;max-width:440px;margin:0 auto;padding:24px">` +
    `<h2 style="color:#333">${escapeHtml(venueName)}</h2>${htmlLines}</div>`

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: {
            Text: { Data: text },
            Html: { Data: html },
          },
        },
      },
    }),
  )
}

/**
 * Base URL of the business portal (Reports/Plans panels live here). Mirrors the
 * `webBaseUrl()` accessor in auth/service.ts; the default matches the prod
 * business subdomain in `shared/security/origins.ts`.
 */
function businessPortalBaseUrl(): string {
  return (process.env['AREA_CODE_BUSINESS_URL'] ?? 'https://business.areacode.co.za').replace(/\/+$/, '')
}

/**
 * Transactional email-verification message. Non-blocking: the user can already
 * use the app; this link flips their `emailVerified` flag and unlocks gated
 * actions (e.g. reward redemption). The link carries an opaque, single-use,
 * TTL-bound token — no PII beyond the destination address.
 */
export async function sendEmailVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: 'Confirm your email for Area Code' },
          Body: {
            Text: {
              Data: `Welcome to Area Code!\n\nConfirm your email address to unlock rewards and keep your account secure:\n${verifyUrl}\n\nThis link expires in 24 hours. If you didn't create an account, you can ignore this email.`,
            },
            Html: {
              Data: `<div style="font-family:sans-serif;max-width:440px;margin:0 auto;padding:24px"><h2 style="color:#333">Confirm your email</h2><p style="color:#444;font-size:15px;line-height:1.5">Welcome to Area Code! Confirm your email to unlock rewards and keep your account secure.</p><p style="margin:24px 0"><a href="${escapeHtml(verifyUrl)}" style="background:#6366f1;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block">Confirm email</a></p><p style="color:#888;font-size:13px">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(verifyUrl)}</span></p><p style="color:#999;font-size:12px;margin-top:24px">This link expires in 24 hours. If you didn't create an account, ignore this email.</p></div>`,
            },
          },
        },
      },
    }),
  )
}
