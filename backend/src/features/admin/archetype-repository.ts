// Admin Archetype Repository — archetypes, genre weights, dashboard metrics
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'

// Simple KV cache for dashboard metrics (60s TTL)
let metricsCache: { data: Record<string, unknown>; expiresAt: number } | null = null

export async function getDashboardMetrics() {
  if (metricsCache && metricsCache.expiresAt > Date.now()) {
    return metricsCache.data
  }

  const [usersResult, bizResult, checkInsResult, todayResult, rewardsResult, reportsResult, erasureResult, flagsResult] =
    await Promise.all([
      documentClient.send(
        new QueryCommand({
          TableName: TableNames.appData,
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :pk',
          ExpressionAttributeValues: { ':pk': 'ALL_USERS' },
          Select: 'COUNT',
        }),
      ),
      documentClient.send(
        new QueryCommand({
          TableName: TableNames.appData,
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :pk',
          ExpressionAttributeValues: { ':pk': 'ALL_BUSINESSES' },
          Select: 'COUNT',
        }),
      ),
      documentClient.send(
        new QueryCommand({
          TableName: TableNames.appData,
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :pk',
          ExpressionAttributeValues: { ':pk': 'METRICS' },
          Limit: 1,
        }),
      ),
      documentClient.send(
        new QueryCommand({
          TableName: TableNames.appData,
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :pk',
          ExpressionAttributeValues: { ':pk': `CHECKINS#${new Date().toISOString().slice(0, 10)}` },
          Select: 'COUNT',
        }),
      ),
      documentClient.send(
        new QueryCommand({
          TableName: TableNames.appData,
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :pk',
          ExpressionAttributeValues: { ':pk': 'ACTIVE_REWARDS' },
          Select: 'COUNT',
        }),
      ),
      documentClient.send(
        new QueryCommand({
          TableName: TableNames.appData,
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :pk',
          FilterExpression: '#status = :pending',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':pk': 'REPORT_QUEUE', ':pending': 'pending' },
          Select: 'COUNT',
        }),
      ),
      documentClient.send(
        new QueryCommand({
          TableName: TableNames.appData,
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :pk',
          FilterExpression: '#status = :pending',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':pk': 'ERASURE_QUEUE', ':pending': 'pending' },
          Select: 'COUNT',
        }),
      ),
      documentClient.send(
        new QueryCommand({
          TableName: TableNames.appData,
          IndexName: 'GSI1',
          KeyConditionExpression: 'gsi1pk = :pk',
          FilterExpression: 'reviewed = :rev',
          ExpressionAttributeValues: { ':pk': 'ABUSE_FLAGS', ':rev': false },
          Select: 'COUNT',
        }),
      ),
    ])

  const totalConsumers = usersResult.Count ?? 0
  const totalBusinesses = bizResult.Count ?? 0
  const metricsItem = checkInsResult.Items?.[0]
  const totalCheckInsAllTime = (metricsItem?.['totalCheckIns'] as number) ?? 0
  const totalCheckInsToday = todayResult.Count ?? 0
  const activeRewards = rewardsResult.Count ?? 0
  const pendingReports = reportsResult.Count ?? 0
  const pendingErasures = erasureResult.Count ?? 0
  const unreviewedAbuseFlags = flagsResult.Count ?? 0

  const data = {
    totalConsumers,
    totalBusinesses,
    totalCheckInsAllTime,
    totalCheckInsToday,
    activeRewards,
    pendingReports,
    pendingErasures,
    unreviewedAbuseFlags,
  }

  metricsCache = { data, expiresAt: Date.now() + 60_000 }
  return data
}

export async function getArchetypes() {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': 'ARCHETYPES' },
      ScanIndexForward: false,
    }),
  )
  return (result.Items || []).map((item) => ({
    id: item['archetypeId'] as string,
    name: item['name'] as string,
    iconId: item['iconId'] as string,
    description: item['description'] as string,
    dimensionThresholds: item['dimensionThresholds'] as Record<string, number>,
    priority: item['priority'] as number,
    isActive: item['isActive'] as boolean,
  }))
}

export async function createArchetype(data: {
  id: string
  name: string
  iconId: string
  description: string
  dimensionThresholds: Record<string, number>
  priority: number
  isActive: boolean
}) {
  const item = {
    pk: `ARCHETYPE#${data.id}`,
    sk: `ARCHETYPE#${data.id}`,
    gsi1pk: 'ARCHETYPES',
    gsi1sk: String(data.priority).padStart(5, '0'),
    archetypeId: data.id,
    name: data.name,
    iconId: data.iconId,
    description: data.description,
    dimensionThresholds: data.dimensionThresholds,
    priority: data.priority,
    isActive: data.isActive,
    createdAt: new Date().toISOString(),
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return data
}

export async function updateArchetypeRecord(archetypeId: string, data: Record<string, unknown>) {
  const key = { pk: `ARCHETYPE#${archetypeId}`, sk: `ARCHETYPE#${archetypeId}` }

  const updateParts: string[] = []
  const exprNames: Record<string, string> = {}
  const exprValues: Record<string, unknown> = {}
  let idx = 0
  for (const [k, v] of Object.entries(data)) {
    if (k === 'id') continue
    const nameKey = `#f${idx}`
    const valKey = `:v${idx}`
    exprNames[nameKey] = k
    exprValues[valKey] = v
    updateParts.push(`${nameKey} = ${valKey}`)
    idx++
  }
  if (data['priority'] !== undefined) {
    exprNames['#gsi1sk'] = 'gsi1sk'
    exprValues[':gsi1sk'] = String(data['priority']).padStart(5, '0')
    updateParts.push('#gsi1sk = :gsi1sk')
  }

  if (updateParts.length === 0) return null

  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.appData,
      Key: key,
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
      ReturnValues: 'ALL_NEW',
    }),
  )
  const item = result.Attributes
  if (!item) return null
  return {
    id: item['archetypeId'] as string,
    name: item['name'] as string,
    iconId: item['iconId'] as string,
    description: item['description'] as string,
    dimensionThresholds: item['dimensionThresholds'] as Record<string, number>,
    priority: item['priority'] as number,
    isActive: item['isActive'] as boolean,
  }
}

export async function getGenreWeights() {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: 'GENRE_WEIGHTS', sk: 'MATRIX' },
    }),
  )
  if (!result.Item) return null
  return result.Item['matrix'] as Array<{ genre: string; weights: Record<string, number> }>
}

export async function updateGenreWeightsRecord(matrix: Array<{ genre: string; weights: Record<string, number> }>) {
  const item = {
    pk: 'GENRE_WEIGHTS',
    sk: 'MATRIX',
    matrix,
    updatedAt: new Date().toISOString(),
  }
  await documentClient.send(new PutCommand({ TableName: TableNames.appData, Item: item }))
  return matrix
}
