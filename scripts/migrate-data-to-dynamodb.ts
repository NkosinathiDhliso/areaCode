#!/usr/bin/env tsx
/**
 * Data Migration Script: RDS PostgreSQL → DynamoDB
 * 
 * This script migrates data from RDS PostgreSQL to DynamoDB tables.
 * Run after restoring the RDS snapshot to a temporary instance.
 * 
 * Usage: npx tsx scripts/migrate-data-to-dynamodb.ts
 */

import { DynamoDBDocumentClient, BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { PrismaClient } from '@prisma/client'
import { generateId } from '../backend/src/shared/db/entities.js'

const prisma = new PrismaClient()

const ddbClient = new DynamoDBClient({ region: process.env['AWS_REGION'] || 'us-east-1' })
const documentClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
})

const TableNames = {
  users: process.env['USERS_TABLE'] || 'area-code-prod-users',
  nodes: process.env['NODES_TABLE'] || 'area-code-prod-nodes',
  checkins: process.env['CHECKINS_TABLE'] || 'area-code-prod-checkins',
  rewards: process.env['REWARDS_TABLE'] || 'area-code-prod-rewards',
  businesses: process.env['BUSINESSES_TABLE'] || 'area-code-prod-businesses',
  appData: process.env['APP_DATA_TABLE'] || 'area-code-prod-app-data',
}

// ============================================================================
// MIGRATION FUNCTIONS
// ============================================================================

async function migrateUsers() {
  console.log('Migrating users...')
  const users = await prisma.user.findMany()
  
  for (const user of users) {
    await documentClient.send(
      new PutCommand({
        TableName: TableNames.users,
        Item: {
          pk: `USER#${user.id}`,
          sk: `PROFILE#${user.id}`,
          userId: user.id,
          phone: user.phone,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          cityId: user.cityId,
          neighbourhoodId: user.neighbourhoodId,
          tier: user.tier,
          totalCheckIns: user.totalCheckIns,
          streakCount: user.streakCount,
          cognitoSub: user.cognitoSub,
          musicGenres: user.musicGenres,
          dimensionScores: user.dimensionScores,
          archetypeId: user.archetypeId,
          streamingProvider: user.streamingProvider,
          createdAt: user.createdAt.toISOString(),
          updatedAt: new Date().toISOString(),
        },
      })
    )
  }
  
  console.log(`  ✓ Migrated ${users.length} users`)
}

async function migrateBusinesses() {
  console.log('Migrating businesses...')
  const businesses = await prisma.businessAccount.findMany()
  
  for (const business of businesses) {
    await documentClient.send(
      new PutCommand({
        TableName: TableNames.businesses,
        Item: {
          pk: `BUSINESS#${business.id}`,
          sk: `PROFILE#${business.id}`,
          businessId: business.id,
          email: business.email,
          phone: business.phone,
          businessName: business.businessName,
          registrationNumber: business.registrationNumber,
          cognitoSub: business.cognitoSub,
          tier: business.tier,
          trialEndsAt: business.trialEndsAt?.toISOString(),
          paymentGraceUntil: business.paymentGraceUntil?.toISOString(),
          yocoCustomerId: business.yocoCustomerId,
          isActive: business.isActive,
          createdAt: business.createdAt.toISOString(),
          updatedAt: new Date().toISOString(),
        },
      })
    )
  }
  
  console.log(`  ✓ Migrated ${businesses.length} businesses`)
}

async function migrateNodes() {
  console.log('Migrating nodes...')
  const nodes = await prisma.node.findMany()
  
  for (const node of nodes) {
    await documentClient.send(
      new PutCommand({
        TableName: TableNames.nodes,
        Item: {
          pk: `NODE#${node.id}`,
          sk: `PROFILE#${node.id}`,
          nodeId: node.id,
          name: node.name,
          slug: node.slug,
          category: node.category,
          lat: node.lat,
          lng: node.lng,
          cityId: node.cityId,
          businessId: node.businessId,
          submittedBy: node.submittedBy,
          claimStatus: node.claimStatus,
          claimCipcStatus: node.claimCipcStatus,
          nodeColour: node.nodeColour,
          nodeIcon: node.nodeIcon,
          qrCheckinEnabled: node.qrCheckinEnabled,
          isVerified: node.isVerified,
          isActive: node.isActive,
          createdAt: node.createdAt.toISOString(),
          updatedAt: new Date().toISOString(),
        },
      })
    )
  }
  
  console.log(`  ✓ Migrated ${nodes.length} nodes`)
}

async function migrateCheckIns() {
  console.log('Migrating check-ins...')
  const checkIns = await prisma.checkIn.findMany()
  
  // Batch write for efficiency
  const batchSize = 25
  for (let i = 0; i < checkIns.length; i += batchSize) {
    const batch = checkIns.slice(i, i + batchSize)
    
    const writeRequests = batch.map((checkIn) => ({
      PutRequest: {
        Item: {
          pk: `CHECKIN#${checkIn.id}`,
          sk: `CHECKIN#${checkIn.id}`,
          checkInId: checkIn.id,
          userId: checkIn.userId,
          nodeId: checkIn.nodeId,
          neighbourhoodId: checkIn.neighbourhoodId,
          type: checkIn.type,
          checkedInAt: checkIn.checkedInAt.toISOString(),
          // GSIs
          gsi1pk: `USER#${checkIn.userId}`,
          gsi1sk: checkIn.checkedInAt.toISOString(),
          gsi2pk: `NODE#${checkIn.nodeId}`,
          gsi2sk: checkIn.checkedInAt.toISOString(),
        },
      },
    }))
    
    await documentClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TableNames.checkins]: writeRequests,
        },
      })
    )
  }
  
  console.log(`  ✓ Migrated ${checkIns.length} check-ins`)
}

async function migrateRewards() {
  console.log('Migrating rewards...')
  const rewards = await prisma.reward.findMany()
  
  for (const reward of rewards) {
    await documentClient.send(
      new PutCommand({
        TableName: TableNames.rewards,
        Item: {
          pk: `REWARD#${reward.id}`,
          sk: `REWARD#${reward.id}`,
          rewardId: reward.id,
          nodeId: reward.nodeId,
          type: reward.type,
          title: reward.title,
          description: reward.description,
          triggerValue: reward.triggerValue,
          totalSlots: reward.totalSlots,
          claimedCount: reward.claimedCount,
          slotsLocked: reward.slotsLocked,
          isActive: reward.isActive,
          expiresAt: reward.expiresAt?.toISOString(),
          createdAt: reward.createdAt.toISOString(),
          updatedAt: new Date().toISOString(),
        },
      })
    )
  }
  
  console.log(`  ✓ Migrated ${rewards.length} rewards`)
}

async function migrateStaffAccounts() {
  console.log('Migrating staff accounts...')
  const staff = await prisma.staffAccount.findMany()
  
  for (const member of staff) {
    await documentClient.send(
      new PutCommand({
        TableName: TableNames.appData,
        Item: {
          pk: `STAFF#${member.id}`,
          sk: `PROFILE#${member.id}`,
          staffId: member.id,
          businessId: member.businessId,
          name: member.name,
          phone: member.phone,
          cognitoSub: member.cognitoSub,
          isActive: member.isActive,
          createdAt: member.createdAt.toISOString(),
          gsi1pk: member.cognitoSub ? `COGNITO#${member.cognitoSub}` : undefined,
          gsi1sk: `BUSINESS#${member.businessId}`,
        },
      })
    )
  }
  
  console.log(`  ✓ Migrated ${staff.length} staff accounts`)
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('============================================')
  console.log('  RDS → DynamoDB Data Migration')
  console.log('============================================')
  console.log('')
  
  try {
    await migrateUsers()
    await migrateBusinesses()
    await migrateNodes()
    await migrateCheckIns()
    await migrateRewards()
    await migrateStaffAccounts()
    
    console.log('')
    console.log('============================================')
    console.log('  Migration Complete!')
    console.log('============================================')
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
