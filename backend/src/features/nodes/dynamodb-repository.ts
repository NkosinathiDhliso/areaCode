// DynamoDB Repository for Nodes Feature
import { GetCommand, QueryCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import { encodeGeohash, haversineMetres, neighbourCells, pickPrecision } from '../../shared/db/geohash.js'
import type { Node, NodeImage } from './types.js'

// ============================================================================
// NODE OPERATIONS
// ============================================================================

export async function getNodeById(nodeId: string): Promise<Node | null> {
  const result = await documentClient.send(new GetCommand({ TableName: TableNames.nodes, Key: { nodeId } }))
  return result.Item ? mapNode(result.Item) : null
}

export async function getNodeBySlug(slug: string): Promise<Node | null> {
  let lastKey: Record<string, unknown> | undefined
  do {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.nodes,
        FilterExpression: 'slug = :slug',
        ExpressionAttributeValues: { ':slug': slug },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    )
    if (result.Items?.[0]) return result.Items[0] as Node
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (lastKey)
  return null
}

export async function getNodesByBusinessId(businessId: string): Promise<Node[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :businessId',
      ExpressionAttributeValues: { ':businessId': businessId },
    }),
  )
  return (result.Items || []) as Node[]
}

export async function createNode(data: Omit<Node, 'nodeId' | 'createdAt'>): Promise<Node> {
  const nodeId = generateId()
  const now = new Date().toISOString()

  const node: Node = {
    ...data,
    nodeId,
    createdAt: now,
    updatedAt: now,
    claimStatus: data.claimStatus || 'unclaimed',
    isVerified: data.isVerified ?? false,
    isActive: data.isActive ?? true,
    qrCheckinEnabled: data.qrCheckinEnabled ?? false,
    nodeColour: data.nodeColour || 'default',
  }

  // Precompute geohash attributes for sparse spatial index (see shared/db/geohash.ts).
  const geohash5 = encodeGeohash(node.lat, node.lng, 5)
  const geohash7 = encodeGeohash(node.lat, node.lng, 7)

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.nodes,
      Item: { ...node, id: nodeId, geohash5, geohash7 },
    }),
  )

  return mapNode(node as unknown as Record<string, unknown>)
}

export async function updateNode(
  nodeId: string,
  data: Partial<Omit<Node, 'nodeId' | 'createdAt'>>,
): Promise<Node | null> {
  const updateExpr = Object.keys(data)
    .map((key) => `#${key} = :${key}`)
    .join(', ')

  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.nodes,
      Key: { nodeId },
      UpdateExpression: `SET ${updateExpr}, #updatedAt = :updatedAt`,
      ExpressionAttributeNames: {
        ...Object.keys(data).reduce((acc, key) => ({ ...acc, [`#${key}`]: key }), {}),
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ...Object.entries(data).reduce((acc, [key, value]) => ({ ...acc, [`:${key}`]: value }), {}),
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }),
  )

  return result.Attributes ? mapNode(result.Attributes) : null
}

export async function deleteNode(nodeId: string): Promise<void> {
  await documentClient.send(new DeleteCommand({ TableName: TableNames.nodes, Key: { nodeId } }))
}

export async function listNodes(options?: {
  cityId?: string
  category?: string
  isActive?: boolean
  limit?: number
  cursor?: string
}): Promise<{ nodes: Node[]; nextCursor?: string }> {
  let result

  if (options?.cityId) {
    // Query by city using location index
    result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.nodes,
        IndexName: 'LocationIndex',
        KeyConditionExpression: 'cityId = :cityId',
        ExpressionAttributeValues: { ':cityId': options.cityId },
        Limit: options.limit || 50,
        ...(options.cursor ? { ExclusiveStartKey: JSON.parse(Buffer.from(options.cursor, 'base64').toString()) } : {}),
      }),
    )
  } else {
    // Scan with filters
    let filterExpr = ''
    const exprAttrValues: Record<string, unknown> = {}

    if (options?.category) {
      filterExpr = 'category = :category'
      exprAttrValues[':category'] = options.category
    }
    if (options?.isActive !== undefined) {
      filterExpr = filterExpr ? `${filterExpr} AND isActive = :isActive` : 'isActive = :isActive'
      exprAttrValues[':isActive'] = options.isActive
    }

    result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.nodes,
        ...(filterExpr ? { FilterExpression: filterExpr } : {}),
        ExpressionAttributeValues: exprAttrValues,
        Limit: options?.limit || 50,
      }),
    )
  }

  const nodes = (result.Items || []) as Node[]
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined

  return { nodes: nodes.map((n) => mapNode(n as unknown as Record<string, unknown>)), nextCursor }
}

function mapNode(item: Record<string, unknown>): Node {
  return {
    nodeId: (item['nodeId'] as string) ?? (item['id'] as string),
    name: item['name'] as string,
    slug: item['slug'] as string,
    category: item['category'] as string,
    lat: item['lat'] as number,
    lng: item['lng'] as number,
    cityId: item['cityId'] as string | undefined,
    businessId: item['businessId'] as string | undefined,
    submittedBy: item['submittedBy'] as string | undefined,
    claimStatus: (item['claimStatus'] as string) ?? 'unclaimed',
    claimCipcStatus: item['claimCipcStatus'] as string | undefined,
    nodeColour: (item['nodeColour'] as string) ?? '#000000',
    nodeIcon: item['nodeIcon'] as string | undefined,
    qrCheckinEnabled: (item['qrCheckinEnabled'] as boolean) ?? false,
    isVerified: (item['isVerified'] as boolean) ?? false,
    isActive: (item['isActive'] as boolean) ?? true,
    boostUntil: (item['boostUntil'] as string | null | undefined) ?? null,
    createdAt: (item['createdAt'] as string) ?? '',
    updatedAt: (item['updatedAt'] as string) ?? '',
  }
}

// ============================================================================
// NODE IMAGES
// ============================================================================

export async function getNodeImages(nodeId: string): Promise<NodeImage[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `NODE#${nodeId}`,
        ':skPrefix': 'IMAGE#',
      },
    }),
  )
  return (result.Items || []) as NodeImage[]
}

export async function addNodeImage(data: Omit<NodeImage, 'imageId' | 'createdAt'>): Promise<NodeImage> {
  const imageId = generateId()
  const now = new Date().toISOString()

  const image: NodeImage = {
    ...data,
    imageId,
    createdAt: now,
  }

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `NODE#${data.nodeId}`,
        sk: `IMAGE#${imageId}`,
        ...image,
      },
    }),
  )

  return image
}

export async function deleteNodeImage(nodeId: string, imageId: string): Promise<void> {
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.appData,
      Key: { pk: `NODE#${nodeId}`, sk: `IMAGE#${imageId}` },
    }),
  )
}

// ============================================================================
// NEARBY SEARCH (Using lat/lng comparison)
// ============================================================================

let _nearbyScanWarned = false

/**
 * Geohash-backed spatial query — O(9 queries) regardless of table size.
 *
 *   1. Pick a geohash precision whose cell size comfortably exceeds the radius.
 *   2. Compute the centre cell + 8 neighbours (avoids edge misses).
 *   3. Query the Geohash5Index GSI for each cell in parallel.
 *   4. Filter by exact Haversine distance and sort.
 *
 * Falls back to Scan with a warning if the GSI is not yet provisioned.
 */
export async function findNearbyNodes(
  lat: number,
  lng: number,
  radiusKm: number = 5,
  options?: { category?: string; limit?: number },
): Promise<Node[]> {
  const radiusMetres = radiusKm * 1000
  const precision = pickPrecision(radiusMetres)
  const cells = neighbourCells(lat, lng, precision)
  const limit = options?.limit ?? 20

  let items: Array<Record<string, unknown>> = []

  try {
    const perCell = await Promise.all(
      cells.map((cell) => {
        const values: Record<string, unknown> = { ':a': true }
        let keyCondition: string
        if (precision === 5) {
          values[':c'] = cell
          keyCondition = 'geohash5 = :c'
        } else {
          values[':c'] = cell.slice(0, 5)
          values[':p'] = cell.slice(0, precision)
          keyCondition = 'geohash5 = :c AND begins_with(geohash7, :p)'
        }
        if (options?.category) values[':cat'] = options.category

        return documentClient
          .send(
            new QueryCommand({
              TableName: TableNames.nodes,
              IndexName: 'Geohash5Index',
              KeyConditionExpression: keyCondition,
              FilterExpression: options?.category
                ? 'isActive = :a AND category = :cat'
                : 'isActive = :a',
              ExpressionAttributeValues: values,
            }),
          )
          .then((r) => r.Items ?? [])
      }),
    )
    items = perCell.flat()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('specified index') || msg.includes('does not have the specified')) {
      if (!_nearbyScanWarned) {
        _nearbyScanWarned = true
        console.warn(
          '[nodes.findNearbyNodes] Geohash5Index GSI not provisioned — falling back to Scan. ' +
            'Apply infra/SCALE_GSI_ADDITIONS.md to fix at scale.',
        )
      }
      const result = await documentClient.send(
        new ScanCommand({
          TableName: TableNames.nodes,
          FilterExpression: options?.category ? 'isActive = :a AND category = :cat' : 'isActive = :a',
          ExpressionAttributeValues: options?.category
            ? { ':a': true, ':cat': options.category }
            : { ':a': true },
        }),
      )
      items = (result.Items || []) as Array<Record<string, unknown>>
    } else {
      throw err
    }
  }

  // De-dupe (cells can overlap), compute exact distance, filter, sort, limit.
  const seen = new Set<string>()
  const scored: Array<{ node: Node; distance: number }> = []
  for (const item of items) {
    const nodeId = (item['nodeId'] ?? item['id']) as string
    if (!nodeId || seen.has(nodeId)) continue
    seen.add(nodeId)
    const n = mapNode(item)
    const distM = haversineMetres(lat, lng, n.lat, n.lng)
    if (distM <= radiusMetres) scored.push({ node: n, distance: distM })
  }
  scored.sort((a, b) => a.distance - b.distance)
  return scored.slice(0, limit).map((s) => s.node)
}
