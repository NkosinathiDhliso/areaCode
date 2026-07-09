import { ScanCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { sendTrialExpiryEmail } from '../../shared/email/ses.js'

import { sendRenewalReminders } from './service.js'

/**
 * Scheduled handler (EventBridge daily) that sends trial expiry reminders and
 * pre-lapse renewal reminders.
 *
 * Trial reminders fire at 3 days and 1 day before trial expiry. The renewal
 * sweep (billing-revenue-integrity R3.4) additionally emails paid monthly/yearly
 * businesses whose `paidUntil` is within 7 days, one send per paid window.
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

  // billing-revenue-integrity R3.4: the same daily worker sends the pre-lapse
  // renewal reminder (paid monthly/yearly, `paidUntil` within 7 days). Isolated
  // in a try/catch so a renewal-query failure never blocks the trial-expiry
  // nudges above and is logged loudly rather than swallowed silently.
  let renewalReminded = 0
  try {
    const renewal = await sendRenewalReminders(now)
    renewalReminded = renewal.reminded
  } catch (err) {
    console.warn(`[trial-reminder] renewal reminder sweep failed: ${String(err)}`)
  }

  return { sent, scanned: businesses.length, renewalReminded }
}
