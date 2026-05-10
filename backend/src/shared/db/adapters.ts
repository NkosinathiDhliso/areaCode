// DTO adapters: map Prisma rows (`id`-keyed) to the legacy DynamoDB-shaped
// DTOs (`userId`/`nodeId`/`businessId`/`staffId`/`checkInId`-keyed) that the
// rest of the app expects.
//
// This isolates the rename from every call site. After Phase 3, these adapters
// will go away and we'll use Prisma types directly.
import type {
  User as PrismaUser,
  BusinessAccount as PrismaBusiness,
  StaffAccount as PrismaStaff,
  CheckIn as PrismaCheckIn,
  Node as PrismaNode,
  NodeImage as PrismaNodeImage,
  Reward as PrismaReward,
} from '@prisma/client'
import type { User, BusinessAccount, StaffAccount } from '../../features/auth/types.js'
import type { CheckIn } from '../../features/check-in/types.js'
import type { Node, NodeImage } from '../../features/nodes/types.js'

// ─── Users ──────────────────────────────────────────────────────────────────

export function userFromPrisma(row: PrismaUser): User {
  return {
    id: row.id,
    userId: row.id,
    phone: row.phone ?? undefined,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl ?? null,
    cityId: row.cityId ?? undefined,
    neighbourhoodId: row.neighbourhoodId ?? undefined,
    tier: row.tier,
    totalCheckIns: row.totalCheckIns,
    streakCount: row.streakCount,
    cognitoSub: row.cognitoSub ?? undefined,
    musicGenres: row.musicGenres ?? [],
    dimensionScores: (row.dimensionScores as Record<string, unknown> | null) ?? undefined,
    archetypeId: row.archetypeId ?? undefined,
    streamingProvider: row.streamingProvider ?? undefined,
    createdAt: row.createdAt.toISOString(),
  }
}

// ─── Businesses ─────────────────────────────────────────────────────────────

export function businessFromPrisma(row: PrismaBusiness): BusinessAccount {
  return {
    id: row.id,
    businessId: row.id,
    email: row.email,
    phone: row.phone ?? undefined,
    businessName: row.businessName,
    registrationNumber: row.registrationNumber ?? undefined,
    cognitoSub: row.cognitoSub ?? undefined,
    tier: row.tier,
    trialEndsAt: row.trialEndsAt?.toISOString(),
    paymentGraceUntil: row.paymentGraceUntil?.toISOString(),
    yocoCustomerId: row.yocoCustomerId ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  }
}

// ─── Staff ──────────────────────────────────────────────────────────────────

export function staffFromPrisma(row: PrismaStaff): StaffAccount {
  return {
    id: row.id,
    staffId: row.id,
    businessId: row.businessId,
    name: row.name,
    phone: row.phone,
    cognitoSub: row.cognitoSub ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  }
}

// ─── Check-Ins ──────────────────────────────────────────────────────────────

export function checkInFromPrisma(row: PrismaCheckIn): CheckIn {
  return {
    checkInId: row.id,
    userId: row.userId,
    nodeId: row.nodeId,
    neighbourhoodId: row.neighbourhoodId ?? undefined,
    type: row.type,
    checkedInAt: row.checkedInAt.toISOString(),
  }
}

// ─── Nodes ──────────────────────────────────────────────────────────────────

export function nodeFromPrisma(row: PrismaNode): Node {
  return {
    nodeId: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    lat: row.lat,
    lng: row.lng,
    cityId: row.cityId ?? undefined,
    businessId: row.businessId ?? undefined,
    submittedBy: row.submittedBy ?? undefined,
    claimStatus: row.claimStatus,
    claimCipcStatus: row.claimCipcStatus ?? undefined,
    nodeColour: row.nodeColour,
    nodeIcon: row.nodeIcon ?? undefined,
    qrCheckinEnabled: row.qrCheckinEnabled,
    isVerified: row.isVerified,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.createdAt.toISOString(),
  }
}

export function nodeImageFromPrisma(row: PrismaNodeImage): NodeImage {
  return {
    imageId: row.id,
    nodeId: row.nodeId,
    s3Key: row.s3Key,
    displayOrder: row.displayOrder,
    uploadedBy: row.uploadedBy ?? undefined,
    createdAt: row.createdAt.toISOString(),
  }
}

// ─── Rewards (used by nodes/repository.ts cross-feature) ────────────────────

export interface RewardDto {
  rewardId: string
  id?: string
  nodeId: string
  type: string
  title: string
  description?: string
  triggerValue?: number
  totalSlots?: number
  claimedCount: number
  isActive: boolean
  expiresAt?: string
  createdAt: string
}

export function rewardFromPrisma(row: PrismaReward): RewardDto {
  return {
    rewardId: row.id,
    id: row.id,
    nodeId: row.nodeId,
    type: row.type,
    title: row.title,
    description: row.description ?? undefined,
    triggerValue: row.triggerValue ?? undefined,
    totalSlots: row.totalSlots ?? undefined,
    claimedCount: row.claimedCount,
    isActive: row.isActive,
    expiresAt: row.expiresAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}
