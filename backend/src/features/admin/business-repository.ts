// Admin Business Repository — business management and search
import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import {
  getBusinessById as getDynamoBusiness,
  updateBusiness,
  getStaffByBusinessId,
} from '../auth/dynamodb-repository.js'

export async function getBusinessById(businessId: string) {
  const biz = await getDynamoBusiness(businessId)
  if (!biz) return null

  const nodesResult = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.nodes,
      IndexName: 'BusinessIndex',
      KeyConditionExpression: 'businessId = :bid',
      ExpressionAttributeValues: { ':bid': businessId },
    }),
  )
  const nodes = (nodesResult.Items || []).map((n) => ({
    id: n['nodeId'] ?? n['id'],
    name: n['name'],
    slug: n['slug'],
    claimStatus: n['claimStatus'],
  }))

  const staffAccounts = await getStaffByBusinessId(businessId)

  return { ...biz, id: biz.businessId, nodes, staffAccounts: staffAccounts.filter((s: any) => s.isActive !== false) }
}

export async function extendBusinessTrial(businessId: string, days: number) {
  const biz = await getDynamoBusiness(businessId)
  if (!biz) return null

  const trialEndsAt = biz.trialEndsAt as string | undefined
  const base = trialEndsAt && new Date(trialEndsAt) > new Date() ? new Date(trialEndsAt) : new Date()
  const newEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

  return updateBusiness(businessId, { trialEndsAt: newEnd } as any)
}

export async function searchBusinesses(query: string) {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': 'ALL_BUSINESSES' },
      Limit: 200,
    }),
  )
  const allBiz = result.Items || []
  const filtered = query
    ? allBiz.filter((b) => {
        const q = query.toLowerCase()
        const name = ((b['businessName'] as string) || '').toLowerCase()
        const email = ((b['email'] as string) || '').toLowerCase()
        return name.includes(q) || email.includes(q)
      })
    : allBiz
  const sliced = filtered.slice(0, 50)

  const enriched = await Promise.all(
    sliced.map(async (b) => {
      const businessId = (b['businessId'] ?? b['id']) as string

      const [staffCount, nodeCount, activeRewardCount] = await Promise.all([
        getStaffByBusinessId(businessId)
          .then((r) => r.filter((s: any) => s.isActive !== false).length)
          .catch(() => 0),
        documentClient
          .send(
            new QueryCommand({
              TableName: TableNames.nodes,
              IndexName: 'BusinessIndex',
              KeyConditionExpression: 'businessId = :bid',
              ExpressionAttributeValues: { ':bid': businessId },
              Select: 'COUNT',
            }),
          )
          .then((r) => r.Count ?? 0)
          .catch(() => 0),
        documentClient
          .send(
            new QueryCommand({
              TableName: TableNames.rewards,
              IndexName: 'BusinessIndex',
              KeyConditionExpression: 'businessId = :bid',
              FilterExpression: 'isActive = :active',
              ExpressionAttributeValues: { ':bid': businessId, ':active': true },
              Select: 'COUNT',
            }),
          )
          .then((r) => r.Count ?? 0)
          .catch(() => 0),
      ])

      return { ...b, id: businessId, staffCount, nodeCount, activeRewardCount }
    }),
  )
  return enriched
}
