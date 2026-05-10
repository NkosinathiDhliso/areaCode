/**
 * System Health Service — queries CloudWatch metrics for admin dashboard.
 * Returns Lambda error rate, DLQ depth, and last successful Yoco webhook timestamp.
 */

import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import { logger } from '../../shared/monitoring/logger.js'

const cw = new CloudWatchClient({})
const sqs = new SQSClient({})

const healthLogger = logger.child({ service: 'system-health' })

export interface SystemHealthMetrics {
  lambdaErrorRate: number | null
  dlqDepth: number
  lastSuccessfulYocoWebhook: string | null
}

export async function getSystemHealth(): Promise<SystemHealthMetrics> {
  const env = process.env['AREA_CODE_ENV'] ?? 'dev'
  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

  let lambdaErrorRate: number | null = null
  let dlqDepth = 0
  let lastSuccessfulYocoWebhook: string | null = null

  // 1. Lambda error rate (last hour)
  try {
    const result = await cw.send(
      new GetMetricDataCommand({
        StartTime: oneHourAgo,
        EndTime: now,
        MetricDataQueries: [
          {
            Id: 'errors',
            MetricStat: {
              Metric: {
                Namespace: 'AWS/Lambda',
                MetricName: 'Errors',
                Dimensions: [{ Name: 'FunctionName', Value: `area-code-${env}-api` }],
              },
              Period: 3600,
              Stat: 'Sum',
            },
          },
          {
            Id: 'invocations',
            MetricStat: {
              Metric: {
                Namespace: 'AWS/Lambda',
                MetricName: 'Invocations',
                Dimensions: [{ Name: 'FunctionName', Value: `area-code-${env}-api` }],
              },
              Period: 3600,
              Stat: 'Sum',
            },
          },
        ],
      }),
    )

    const errorsData = result.MetricDataResults?.find((r) => r.Id === 'errors')
    const invocationsData = result.MetricDataResults?.find((r) => r.Id === 'invocations')
    const errors = errorsData?.Values?.[0] ?? 0
    const invocations = invocationsData?.Values?.[0] ?? 0

    lambdaErrorRate = invocations > 0 ? Math.round((errors / invocations) * 10000) / 100 : 0
  } catch (err) {
    healthLogger.error('Failed to fetch Lambda error rate from CloudWatch', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // 2. DLQ depth (sum of all DLQs)
  const dlqNames = [`area-code-${env}-reward-eval-dlq`, `area-code-${env}-push-sender-dlq`, `area-code-${env}-report-generation-dlq`]

  for (const queueName of dlqNames) {
    try {
      const queueUrl = `https://sqs.us-east-1.amazonaws.com/${process.env['AWS_ACCOUNT_ID'] ?? ''}/${queueName}`
      const attrs = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        }),
      )
      const count = parseInt(attrs.Attributes?.['ApproximateNumberOfMessages'] ?? '0', 10)
      dlqDepth += count
    } catch {
      // Queue may not exist in local dev — skip silently
    }
  }

  // 3. Last successful Yoco webhook — check Lambda invocations without errors
  try {
    const result = await cw.send(
      new GetMetricDataCommand({
        StartTime: new Date(now.getTime() - 24 * 60 * 60 * 1000), // last 24h
        EndTime: now,
        MetricDataQueries: [
          {
            Id: 'invocations',
            MetricStat: {
              Metric: {
                Namespace: 'AWS/Lambda',
                MetricName: 'Invocations',
                Dimensions: [{ Name: 'FunctionName', Value: `area-code-${env}-yoco-webhook` }],
              },
              Period: 300,
              Stat: 'Sum',
            },
          },
          {
            Id: 'errors',
            MetricStat: {
              Metric: {
                Namespace: 'AWS/Lambda',
                MetricName: 'Errors',
                Dimensions: [{ Name: 'FunctionName', Value: `area-code-${env}-yoco-webhook` }],
              },
              Period: 300,
              Stat: 'Sum',
            },
          },
        ],
      }),
    )

    const invocationsData = result.MetricDataResults?.find((r) => r.Id === 'invocations')
    const errorsData = result.MetricDataResults?.find((r) => r.Id === 'errors')

    if (invocationsData?.Timestamps && invocationsData.Values) {
      // Find the most recent period with invocations but no errors
      for (let i = 0; i < invocationsData.Timestamps.length; i++) {
        const invCount = invocationsData.Values[i] ?? 0
        const errCount = errorsData?.Values?.[i] ?? 0
        if (invCount > 0 && errCount === 0) {
          lastSuccessfulYocoWebhook = invocationsData.Timestamps[i]!.toISOString()
          break
        }
      }
    }
  } catch (err) {
    healthLogger.error('Failed to fetch Yoco webhook metrics from CloudWatch', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return { lambdaErrorRate, dlqDepth, lastSuccessfulYocoWebhook }
}
