// Admin Moderation Repository — reports, abuse flags, erasure queue
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { getUserById as getDynamoUser } from '../auth/dynamodb-repository.js'
import { getNodeById } from '../nodes/dynamodb-repository.js'

export async function getReportQueue() {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      FilterExpression: '#status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':pk': 'REPORT_QUEUE', ':pending': 'pending' },
      Limit: 50,
    }),
  )
  const reports = (result.Items || []).slice(0, 50)
  const enriched = []
  for (const r of reports) {
    const node = r['nodeId'] ? await getNodeById(r['nodeId'] as string) : null
    enriched.push({
      ...r,
      id: r['reportId'] ?? r['pk'],
      node: node ? { id: node.nodeId, name: node.name, slug: node.slug } : null,
    })
  }
  return enriched
}

export async function updateReportStatus(reportId: string, status: string) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `REPORT#${reportId}` },
      Limit: 1,
    }),
  )
  if (!result.Items?.[0]) return null
  const item = result.Items[0]
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: item['pk'] as string, sk: item['sk'] as string },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status },
    }),
  )
  return { ...item, status }
}

export async function getUnreviewedAbuseFlags() {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      FilterExpression: 'reviewed = :rev',
      ExpressionAttributeValues: { ':pk': 'ABUSE_FLAGS', ':rev': false },
      Limit: 100,
    }),
  )
  return (result.Items || []).slice(0, 100).map((i) => ({ ...i, id: i['flagId'] ?? i['pk'] }))
}

export async function reviewAbuseFlag(flagId: string) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `ABUSE#${flagId}` },
      Limit: 1,
    }),
  )
  if (!result.Items?.[0]) return null
  const item = result.Items[0]
  await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: { pk: item['pk'] as string, sk: item['sk'] as string },
      UpdateExpression: 'SET reviewed = :rev',
      ExpressionAttributeValues: { ':rev': true },
    }),
  )
  return { ...item, reviewed: true }
}

export async function listConsents() {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': 'CONSENTS' },
      Limit: 100,
    }),
  )
  return (result.Items || []).slice(0, 100).map((item) => {
    const pk = (item['pk'] as string) ?? ''
    const userId = pk.startsWith('CONSENT#') ? pk.slice('CONSENT#'.length) : pk
    const id = (item['consentId'] as string) ?? `${pk}:${item['sk'] ?? ''}`
    return {
      ...item,
      id,
      userId,
    }
  })
}

export async function getErasureQueue() {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      FilterExpression: '#status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':pk': 'ERASURE_QUEUE', ':pending': 'pending' },
      Limit: 100,
    }),
  )
  const items = (result.Items || []).slice(0, 100)
  const enriched = []
  for (const item of items) {
    const uid = item['userId'] as string
    const user = uid ? await getDynamoUser(uid) : null
    enriched.push({
      userId: uid,
      username: user?.username ?? 'Unknown',
      requestedAt: (item['requestedAt'] ?? item['createdAt'] ?? '') as string,
      deletesAt: (item['deletesAt'] ?? item['expiresAt'] ?? '') as string,
    })
  }
  return enriched
}
