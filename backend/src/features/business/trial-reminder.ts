import { ScanCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { sendTrialExpiryEmail } from '../../shared/email/ses.js'

/**
 * Scheduled handler (EventBridge daily) that sends trial expiry reminders.
 * Sends at 3 days and 1 day before expiry.
 */
export async function handleTrialReminders() {
  const now = Date.now()
  const threeDaysFromNow = new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const oneDayFromNow = new Date(now + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Scan businesses with active trials
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.businesses,
      FilterExpression: 'attribute_exists(trialEndsAt) AND trialEndsAt > :now',
      ExpressionAttributeValues: { ':now': new Date().toISOString() },
    }),
  )

  const businesses = result.Items ?? []
  let sent = 0

  for (const biz of businesses) {
    const trialEnd = (biz['trialEndsAt'] as string)?.slice(0, 10)
    if (!trialEnd) continue

    const email = biz['email'] as string | undefined
    const name = biz['businessName'] as string | undefined
    if (!email) continue

    if (trialEnd === threeDaysFromNow) {
      await sendTrialExpiryEmail(email, name ?? 'there', 3)
      sent++
    } else if (trialEnd === oneDayFromNow) {
      await sendTrialExpiryEmail(email, name ?? 'there', 1)
      sent++
    }
  }

  return { sent, scanned: businesses.length }
}
