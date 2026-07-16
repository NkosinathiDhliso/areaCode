import { GetCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'

export function normalizeRedemptionCode(code: string): string {
  return code.trim().toUpperCase()
}

export function redemptionCodeAliasKey(code: string): string {
  return `REDEMPTION_CODE#${normalizeRedemptionCode(code)}`
}

export function redemptionCodeAliasItem(code: string, redemptionId: string, createdAt: string) {
  const normalizedCode = normalizeRedemptionCode(code)
  const aliasKey = redemptionCodeAliasKey(normalizedCode)
  return {
    pk: aliasKey,
    sk: aliasKey,
    redemptionId,
    normalizedCode,
    createdAt,
  }
}

export async function getRedemptionIdByCode(code: string): Promise<string | null> {
  const aliasKey = redemptionCodeAliasKey(code)
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: aliasKey, sk: aliasKey },
    }),
  )
  const redemptionId = result.Item?.['redemptionId']
  return typeof redemptionId === 'string' ? redemptionId : null
}
