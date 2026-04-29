import { Entity, schema, string, number, boolean, map, list, any } from 'dynamodb-toolbox'
import { TableNames, documentClient } from './dynamodb.js'

// ============================================================================
// USER ENTITY
// ============================================================================
export const UserEntity = new Entity({
  name: 'User',
  table: TableNames.users,
  schema: schema({
    userId: string().key(),
    phone: string().optional(),
    username: string(),
    displayName: string(),
    avatarUrl: string().optional(),
    cityId: string().optional(),
    neighbourhoodId: string().optional(),
    tier: string().default('local'),
    totalCheckIns: number().default(0),
    streakCount: number().default(0),
    cognitoSub: string().optional(),
    musicGenres: list(string()).default([]),
    dimensionScores: map(any()).optional(),
    archetypeId: string().optional(),
    streamingProvider: string().optional(),
    createdAt: string().default(() => new Date().toISOString()),
    updatedAt: string().default(() => new Date().toISOString()),
    // GSI attributes
    email: string().optional(),
    pk: string().key(),
    sk: string().key(),
  }),
  documentClient,
})

// ============================================================================
// NODE ENTITY
// ============================================================================
export const NodeEntity = new Entity({
  name: 'Node',
  table: TableNames.nodes,
  schema: schema({
    nodeId: string().key(),
    name: string(),
    slug: string(),
    category: string(),
    lat: number(),
    lng: number(),
    cityId: string().optional(),
    businessId: string().optional(),
    submittedBy: string().optional(),
    claimStatus: string().default('unclaimed'),
    claimCipcStatus: string().optional(),
    nodeColour: string().default('default'),
    nodeIcon: string().optional(),
    qrCheckinEnabled: boolean().default(false),
    isVerified: boolean().default(false),
    isActive: boolean().default(true),
    createdAt: string().default(() => new Date().toISOString()),
    updatedAt: string().default(() => new Date().toISOString()),
    // GSI attributes
    pk: string().key(),
    sk: string().key(),
    gsi1pk: string().optional(),
    gsi1sk: string().optional(),
  }),
  documentClient,
})

// ============================================================================
// CHECK-IN ENTITY
// ============================================================================
export const CheckInEntity = new Entity({
  name: 'CheckIn',
  table: TableNames.checkins,
  schema: schema({
    checkInId: string().key(),
    userId: string(),
    nodeId: string(),
    neighbourhoodId: string().optional(),
    type: string().default('reward'),
    checkedInAt: string().default(() => new Date().toISOString()),
    // For TTL (automatic cleanup)
    ttl: number().optional(),
    // GSI attributes
    pk: string().key(),
    sk: string().key(),
    gsi1pk: string().optional(),
    gsi1sk: string().optional(),
  }),
  documentClient,
})

// ============================================================================
// REWARD ENTITY
// ============================================================================
export const RewardEntity = new Entity({
  name: 'Reward',
  table: TableNames.rewards,
  schema: schema({
    rewardId: string().key(),
    nodeId: string(),
    type: string(),
    title: string(),
    description: string().optional(),
    triggerValue: number().optional(),
    totalSlots: number().optional(),
    claimedCount: number().default(0),
    slotsLocked: boolean().default(false),
    isActive: boolean().default(true),
    expiresAt: string().optional(),
    createdAt: string().default(() => new Date().toISOString()),
    updatedAt: string().default(() => new Date().toISOString()),
    // GSI attributes
    pk: string().key(),
    sk: string().key(),
    gsi1pk: string().optional(),
    gsi1sk: string().optional(),
  }),
  documentClient,
})

// ============================================================================
// BUSINESS ENTITY
// ============================================================================
export const BusinessEntity = new Entity({
  name: 'Business',
  table: TableNames.businesses,
  schema: schema({
    businessId: string().key(),
    email: string(),
    phone: string().optional(),
    businessName: string(),
    registrationNumber: string().optional(),
    cognitoSub: string().optional(),
    tier: string().default('free'),
    trialEndsAt: string().optional(),
    paymentGraceUntil: string().optional(),
    yocoCustomerId: string().optional(),
    isActive: boolean().default(true),
    createdAt: string().default(() => new Date().toISOString()),
    updatedAt: string().default(() => new Date().toISOString()),
    // GSI attributes
    pk: string().key(),
    sk: string().key(),
    gsi1pk: string().optional(), // ownerId
    gsi1sk: string().optional(),
  }),
  documentClient,
})

// ============================================================================
// APP DATA ENTITY (Single table for misc data)
// ============================================================================
export const AppDataEntity = new Entity({
  name: 'AppData',
  table: TableNames.appData,
  schema: schema({
    pk: string().key(),
    sk: string().key(),
    gsi1pk: string().optional(),
    gsi1sk: string().optional(),
    data: map(any()).optional(),
    createdAt: string().default(() => new Date().toISOString()),
    updatedAt: string().default(() => new Date().toISOString()),
  }),
  documentClient,
})

// Helper to generate UUID-like IDs
export function generateId(): string {
  return crypto.randomUUID()
}
