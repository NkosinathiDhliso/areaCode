// Report data loading helpers — DynamoDB queries for report generation
import { QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import type { RawCheckIn } from './anonymize.js'
import type { MusicPrefs, ReportMetrics } from './types.js'

/**
 * Get all node IDs and names for a business.
 */
export async function getBusinessNodes(businessId: string): Promise<Array<{ nodeId: string; nodeName: string }>> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :businessId',
      ExpressionAttributeValues: { ':businessId': businessId },
    }),
  )

  return (result.Items || []).map((item) => ({
    nodeId: (item['nodeId'] as string) ?? (item['id'] as string),
    nodeName: (item['name'] as string) ?? 'Unknown',
  }))
}

/**
 * Load all check-ins for a node within the reporting period.
 */
export async function loadCheckInsForNode(nodeId: string, periodStart: string, periodEnd: string): Promise<RawCheckIn[]> {
  const checkIns: RawCheckIn[] = []
  let lastKey: Record<string, unknown> | undefined

  do {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.checkins,
        IndexName: 'NodeIndex',
        KeyConditionExpression: 'nodeId = :nodeId',
        FilterExpression: 'checkedInAt BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':nodeId': nodeId,
          ':start': periodStart,
          ':end': periodEnd,
        },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    )

    for (const item of result.Items || []) {
      checkIns.push({
        userId: item['userId'] as string,
        nodeId: item['nodeId'] as string,
        tier: (item['tier'] as string) ?? 'local',
        checkedInAt: item['checkedInAt'] as string,
        displayName: item['displayName'] as string | undefined,
        phone: item['phone'] as string | undefined,
        email: item['email'] as string | undefined,
        avatarUrl: item['avatarUrl'] as string | undefined,
      })
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (lastKey)

  return checkIns
}

/**
 * Load user tiers and music preferences via BatchGetItem.
 */
export async function loadUserData(userIds: string[]): Promise<Map<string, { tier: string; musicPrefs: MusicPrefs | null }>> {
  const userDataMap = new Map<string, { tier: string; musicPrefs: MusicPrefs | null }>()

  if (userIds.length === 0) return userDataMap

  const batchSize = 100
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize)
    const keys = batch.map((userId) => ({ userId }))

    try {
      const result = await documentClient.send(
        new BatchGetCommand({
          RequestItems: {
            [TableNames.users]: {
              Keys: keys,
              ProjectionExpression:
                'userId, tier, musicGenres, energy, cultural_rootedness, sophistication, edge, spirituality',
            },
          },
        }),
      )

      const items = result.Responses?.[TableNames.users] || []
      for (const item of items) {
        const userId = item['userId'] as string
        const tier = (item['tier'] as string) ?? 'local'

        let musicPrefs: MusicPrefs | null = null
        const genres = item['musicGenres'] as string[] | undefined
        if (genres && genres.length > 0) {
          musicPrefs = {
            energy: (item['energy'] as number) ?? 50,
            cultural_rootedness: (item['cultural_rootedness'] as number) ?? 50,
            sophistication: (item['sophistication'] as number) ?? 50,
            edge: (item['edge'] as number) ?? 50,
            spirituality: (item['spirituality'] as number) ?? 50,
            genres,
          }
        }

        userDataMap.set(userId, { tier, musicPrefs })
      }
    } catch (error) {
      console.error('[generator] Error loading user data batch:', error)
    }
  }

  return userDataMap
}

/**
 * Load category venue metrics for benchmarks.
 */
export async function loadCategoryVenueMetrics(
  businessId: string,
  nodes: Array<{ nodeId: string; nodeName: string }>,
): Promise<ReportMetrics[]> {
  if (nodes.length === 0) return []

  const firstNodeResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      KeyConditionExpression: 'nodeId = :nodeId',
      ExpressionAttributeValues: { ':nodeId': nodes[0]!.nodeId },
      Limit: 1,
    }),
  )

  const firstNode = firstNodeResult.Items?.[0]
  if (!firstNode) return []

  const cityId = firstNode['cityId'] as string | undefined
  const category = firstNode['category'] as string | undefined
  if (!cityId) return []

  const cityNodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'LocationIndex',
      KeyConditionExpression: 'cityId = :cityId',
      ExpressionAttributeValues: { ':cityId': cityId },
    }),
  )

  const cityNodes = cityNodesResult.Items || []
  const comparableNodes = cityNodes.filter((n) => {
    const nodeBusinessId = n['businessId'] as string | undefined
    const nodeCategory = n['category'] as string | undefined
    return nodeBusinessId && nodeBusinessId !== businessId && (!category || nodeCategory === category)
  })

  const metrics: ReportMetrics[] = []
  const seenBusinesses = new Set<string>()

  for (const node of comparableNodes) {
    const nodeBusinessId = node['businessId'] as string
    if (seenBusinesses.has(nodeBusinessId)) continue
    seenBusinesses.add(nodeBusinessId)

    try {
      const metricsResult = await documentClient.send(
        new QueryCommand({
          TableName: TableNames.appData,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: {
            ':pk': `BIZ_METRICS#${nodeBusinessId}`,
            ':prefix': 'LATEST',
          },
          Limit: 1,
        }),
      )

      const metricsItem = metricsResult.Items?.[0]
      if (metricsItem) {
        metrics.push({
          totalCheckIns: (metricsItem['totalCheckIns'] as number) ?? 0,
          uniqueVisitors: (metricsItem['uniqueVisitors'] as number) ?? 0,
          repeatVisitorRate: (metricsItem['repeatVisitorRate'] as number) ?? 0,
          pulseScore: (metricsItem['pulseScore'] as number) ?? 0,
        })
      }
    } catch {
      // Skip this business's metrics on error
    }
  }

  return metrics
}

/**
 * Load all venue visitor maps for journey analysis.
 */
export async function loadAllVenueVisitorMap(
  businessNodeIds: Set<string>,
  periodStart: string,
  periodEnd: string,
  cityId: string | undefined,
  anonymizationSalt: string,
): Promise<Map<string, { name: string; visitors: Set<string> }>> {
  const venueMap = new Map<string, { name: string; visitors: Set<string> }>()

  if (!cityId) return venueMap

  const cityNodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'LocationIndex',
      KeyConditionExpression: 'cityId = :cityId',
      ExpressionAttributeValues: { ':cityId': cityId },
    }),
  )

  const otherNodes = (cityNodesResult.Items || []).filter((n) => {
    const nodeId = (n['nodeId'] as string) ?? (n['id'] as string)
    return !businessNodeIds.has(nodeId)
  })

  for (const node of otherNodes) {
    const nodeId = (node['nodeId'] as string) ?? (node['id'] as string)
    const nodeName = (node['name'] as string) ?? 'Unknown'

    try {
      const checkIns = await loadCheckInsForNode(nodeId, periodStart, periodEnd)
      if (checkIns.length === 0) continue

      const visitors = new Set<string>()
      for (const ci of checkIns) {
        const { createHash } = await import('node:crypto')
        const token = createHash('sha256').update(`${ci.userId}${periodStart}${anonymizationSalt}`).digest('hex')
        visitors.add(token)
      }

      venueMap.set(nodeId, { name: nodeName, visitors })
    } catch {
      // Skip this node on error
    }
  }

  return venueMap
}
