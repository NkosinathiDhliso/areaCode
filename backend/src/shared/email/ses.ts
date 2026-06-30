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
