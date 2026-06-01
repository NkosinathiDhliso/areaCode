import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

const ses = new SESv2Client({ region: process.env['AWS_REGION'] ?? 'us-east-1' })
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
