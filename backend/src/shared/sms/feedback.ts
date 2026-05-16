/**
 * SMS Message Feedback tracking for OTP delivery monitoring.
 *
 * ⚠️  DEAD CODE — DO NOT REVIVE OR EXTEND.
 *
 * SMS authentication is permanently disabled platform-wide. Pilot
 * testing (May 2026) showed unreliable delivery to South African
 * carriers. This module is preserved only because the corresponding
 * Cognito CUSTOM_AUTH challenge handlers are still wired in dev mode
 * for legacy fixture tests.
 *
 * Read `.kiro/steering/no-sms-no-phone-auth.md` before touching this
 * file. If a task seems to require this module, stop and confirm with
 * the user.
 *
 * Original purpose (kept for context only):
 * Uses AWS End User Messaging v2 PutMessageFeedback API to report
 * whether OTP messages were successfully received and used.
 */

import { DynamoDBClient, GetItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'

const region = process.env['AWS_REGION'] ?? 'us-east-1'
const ddbClient = new DynamoDBClient({ region })

type FeedbackStatus = 'RECEIVED' | 'FAILED'

// Pool name → DynamoDB tracking table name
function getTrackingTableName(pool: string): string {
  const env = process.env['AREA_CODE_ENV'] ?? 'dev'
  return `area-code-${env}-${pool}-otp-tracking`
}

/**
 * Report OTP message feedback to AWS End User Messaging v2.
 *
 * Looks up the message ID stored by the create-auth Lambda trigger,
 * then calls PutMessageFeedback with the verification result.
 *
 * This is fire-and-forget , failures are logged but don't block the auth flow.
 */
export async function reportOtpFeedback(phone: string, pool: string, status: FeedbackStatus): Promise<void> {
  try {
    const tableName = getTrackingTableName(pool)

    // Retrieve the message ID stored by the create-auth Lambda
    const result = await ddbClient.send(
      new GetItemCommand({
        TableName: tableName,
        Key: { pk: { S: `otp#${phone}` } },
      }),
    )

    const messageId = result.Item?.['messageId']?.S
    if (!messageId) {
      // No tracking record found , message may have been sent before tracking was enabled
      return
    }

    // Lazy-load the SMS client to avoid cold-start overhead when not needed
    const { PinpointSMSVoiceV2Client, PutMessageFeedbackCommand } =
      await import('@aws-sdk/client-pinpoint-sms-voice-v2')
    const smsClient = new PinpointSMSVoiceV2Client({ region })

    await smsClient.send(
      new PutMessageFeedbackCommand({
        MessageId: messageId,
        MessageFeedbackStatus: status === 'RECEIVED' ? 'RECEIVED' : 'FAILED',
      }),
    )

    // Clean up the tracking record
    await ddbClient.send(
      new DeleteItemCommand({
        TableName: tableName,
        Key: { pk: { S: `otp#${phone}` } },
      }),
    )
  } catch (err) {
    // Log but don't throw , feedback is non-critical and should never block auth
    console.error('OTP feedback reporting failed', {
      phone: phone.slice(0, 6) + '****',
      pool,
      status,
      error: (err as Error).message,
    })
  }
}
