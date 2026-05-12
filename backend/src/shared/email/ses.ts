import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

const ses = new SESv2Client({ region: process.env['AWS_REGION'] ?? 'us-east-1' })
const FROM_EMAIL = process.env['AREA_CODE_FROM_EMAIL'] ?? 'noreply@areacode.co.za'

export async function sendPasswordResetEmail(to: string, code: string) {
  await ses.send(new SendEmailCommand({
    FromEmailAddress: FROM_EMAIL,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: 'Reset your Area Code password' },
        Body: {
          Text: { Data: `Your password reset code is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, ignore this email.` },
          Html: { Data: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px"><h2 style="color:#333">Reset your password</h2><p>Your code is:</p><p style="font-size:32px;font-weight:bold;letter-spacing:4px;color:#6366f1">${code}</p><p style="color:#666;font-size:14px">This code expires in 10 minutes. If you didn't request this, ignore this email.</p></div>` },
        },
      },
    },
  }))
}

export async function sendTrialExpiryEmail(to: string, businessName: string, daysLeft: number) {
  await ses.send(new SendEmailCommand({
    FromEmailAddress: FROM_EMAIL,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: `Your Area Code trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` },
        Body: {
          Text: { Data: `Hi ${businessName},\n\nYour free trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Subscribe to keep your Growth/Pro features.\n\nVisit your Plans panel to choose a plan.` },
        },
      },
    },
  }))
}
