// DynamoDB Repository for Nodes Feature
import {
  GetCommand,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import type { Node, NodeImage } from './types.js'

// ============================================================================
// NODE OPERATIONS
// ============================================================================

export async function getNodeById(nodeId: string): Promise<Node | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.nodes,
      Key: { pk: `NODE#${nodeId}`, sk: `PROFILE#${nodeId}` },
    })
  )
  return result.Item ? (result.Item as Node) : null
}

export async function getNodeBySlug(slug: string): Promise<Node | null> {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.nodes,
      FilterExpression: 'slug = :slug',
      ExpressionAttributeValues: { ':slug': slug },
      Limit: 1,
    })
  )
  return result.Items?.[0] ? (result.Items[0] as Node) : null
}

export async function getNodesByBusinessId(businessId: string): Promise<Node[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :businessId',
      ExpressionAttributeValues: { ':businessId': businessId },
    })
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

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.nodes,
      Item: {
        pk: `NODE#${nodeId}`,
        sk: `PROFILE#${nodeId}`,
        ...node,
      },
    })
  )

  return node
}

export async function updateNode(
  nodeId: string,
  data: Partial<Omit<Node, 'nodeId' | 'createdAt'>>
): Promise<Node | null> {
  const updateExpr = Object.keys(data)
    .map((key) => `#${key} = :${key}`)
    .join(', ')

  const result = await documentClient.send(
    new UpdateCommand({
      TableName: TableNames.nodes,
      Key: { pk: `NODE#${nodeId}`, sk: `PROFILE#${nodeId}` },
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
    })
  )

  return result.Attributes as Node
}

export async function deleteNode(nodeId: string): Promise<void> {
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.nodes,
      Key: { pk: `NODE#${nodeId}`, sk: `PROFILE#${nodeId}` },
    })
  )
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
      })
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
      filterExpr = filterExpr
        ? `${filterExpr} AND isActive = :isActive`
        : 'isActive = :isActive'
      exprAttrValues[':isActive'] = options.isActive
    }

    result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.nodes,
        ...(filterExpr ? { FilterExpression: filterExpr } : {}),
        ExpressionAttributeValues: exprAttrValues,
        Limit: options?.limit || 50,
      })
    )
  }

  const nodes = (result.Items || []) as Node[]
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined

  return { nodes, nextCursor }
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
    })
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
    })
  )

  return image
}

export async function deleteNodeImage(nodeId: string, imageId: string): Promise<void> {
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.appData,
      Key: { pk: `NODE#${nodeId}`, sk: `IMAGE#${imageId}` },
    })
  )
}

// ============================================================================
// NEARBY SEARCH (Using lat/lng comparison)
// ============================================================================

export async function findNearbyNodes(
  lat: number,
  lng: number,
  radiusKm: number = 5,
  options?: { category?: string; limit?: number }
): Promise<Node[]> {
  // For simple implementation, we scan all nodes and filter by distance
  // In production, consider using DynamoDB with Geohash or Elasticsearch
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.nodes,
      FilterExpression: 'isActive = :isActive',
      ExpressionAttributeValues: { ':isActive': true },
    })
  )

  const nodes = (result.Items || []) as Node[]

  // Filter by distance using Haversine formula
  const nearbyNodes = nodes
    .map((node) => ({
      node,
      distance: calculateDistance(lat, lng, node.lat, node.lng),
    }))
    .filter(({ distance }) => distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, options?.limit || 20)
    .map(({ node }) => node)

  return nearbyNodes
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371 // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}
