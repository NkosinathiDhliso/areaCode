// Prisma-backed implementation. Filename retained ("dynamodb-repository.ts")
// until Phase 3 rename so the 12+ existing import sites don't churn in this PR.
//
// All exported function signatures are unchanged — callers see the same
// camelCase DTOs (`userId`, `businessId`, `staffId`) thanks to adapters.ts.

import { prisma } from '../../shared/db/prisma.js'
import {
  userFromPrisma,
  businessFromPrisma,
  staffFromPrisma,
} from '../../shared/db/adapters.js'
import type { User, BusinessAccount, StaffAccount } from './types.js'

// ============================================================================
// USER OPERATIONS
// ============================================================================

export async function getUserById(userId: string): Promise<User | null> {
  const row = await prisma.user.findUnique({ where: { id: userId } })
  return row ? userFromPrisma(row) : null
}

export async function getUserByCognitoSub(cognitoSub: string): Promise<User | null> {
  const row = await prisma.user.findUnique({ where: { cognitoSub } })
  return row ? userFromPrisma(row) : null
}

export async function getUserByPhone(phone: string): Promise<User | null> {
  const row = await prisma.user.findUnique({ where: { phone } })
  return row ? userFromPrisma(row) : null
}

export async function getUserByEmail(_email: string): Promise<User | null> {
  // Users in this schema log in by phone or cognitoSub. Email is reserved for
  // business accounts. Returning null preserves the previous DDB behaviour
  // where the EmailIndex was business-account-shaped on user-table writes.
  return null
}

export async function createUser(
  data: Omit<User, 'userId' | 'createdAt'>,
): Promise<User> {
  const row = await prisma.user.create({
    data: {
      phone: data.phone ?? null,
      username: data.username,
      displayName: data.displayName,
      avatarUrl: data.avatarUrl ?? null,
      cityId: data.cityId ?? null,
      neighbourhoodId: data.neighbourhoodId ?? null,
      tier: data.tier ?? 'local',
      totalCheckIns: data.totalCheckIns ?? 0,
      streakCount: data.streakCount ?? 0,
      cognitoSub: data.cognitoSub ?? null,
      musicGenres: data.musicGenres ?? [],
      dimensionScores: (data.dimensionScores as object | undefined) ?? undefined,
      archetypeId: data.archetypeId ?? null,
      streamingProvider: data.streamingProvider ?? null,
    },
  })
  return userFromPrisma(row)
}

export async function updateUser(
  userId: string,
  data: Partial<Omit<User, 'userId' | 'createdAt'>>,
): Promise<User | null> {
  // Filter to fields that exist on the Prisma User model.
  const update: Record<string, unknown> = {}
  if (data.displayName !== undefined) update['displayName'] = data.displayName
  if (data.avatarUrl !== undefined) update['avatarUrl'] = data.avatarUrl
  if (data.cityId !== undefined) update['cityId'] = data.cityId
  if (data.neighbourhoodId !== undefined) update['neighbourhoodId'] = data.neighbourhoodId
  if (data.tier !== undefined) update['tier'] = data.tier
  if (data.totalCheckIns !== undefined) update['totalCheckIns'] = data.totalCheckIns
  if (data.streakCount !== undefined) update['streakCount'] = data.streakCount
  if (data.cognitoSub !== undefined) update['cognitoSub'] = data.cognitoSub
  if (data.phone !== undefined) update['phone'] = data.phone
  if (data.musicGenres !== undefined) update['musicGenres'] = data.musicGenres
  if (data.dimensionScores !== undefined) update['dimensionScores'] = data.dimensionScores
  if (data.archetypeId !== undefined) update['archetypeId'] = data.archetypeId
  if (data.streamingProvider !== undefined) update['streamingProvider'] = data.streamingProvider

  if (Object.keys(update).length === 0) return getUserById(userId)

  try {
    const row = await prisma.user.update({ where: { id: userId }, data: update })
    return userFromPrisma(row)
  } catch {
    return null
  }
}

export async function deleteUser(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
}

// ============================================================================
// BUSINESS ACCOUNT OPERATIONS
// ============================================================================

export async function getBusinessById(businessId: string): Promise<BusinessAccount | null> {
  const row = await prisma.businessAccount.findUnique({ where: { id: businessId } })
  return row ? businessFromPrisma(row) : null
}

export async function getBusinessByCognitoSub(cognitoSub: string): Promise<BusinessAccount | null> {
  const row = await prisma.businessAccount.findUnique({ where: { cognitoSub } })
  return row ? businessFromPrisma(row) : null
}

export async function getBusinessByEmail(email: string): Promise<BusinessAccount | null> {
  const row = await prisma.businessAccount.findUnique({ where: { email } })
  return row ? businessFromPrisma(row) : null
}

export async function getBusinessByOwnerId(_ownerId: string): Promise<BusinessAccount | null> {
  // The Prisma schema does not currently have an `ownerId` column on
  // business_accounts. Owners are linked via cognitoSub. Preserve the legacy
  // null-on-miss behaviour so callers don't hard-fail.
  return null
}

export async function createBusiness(
  data: Omit<BusinessAccount, 'businessId' | 'createdAt'>,
): Promise<BusinessAccount> {
  const row = await prisma.businessAccount.create({
    data: {
      email: data.email,
      phone: data.phone ?? null,
      businessName: data.businessName,
      registrationNumber: data.registrationNumber ?? null,
      cognitoSub: data.cognitoSub ?? null,
      tier: data.tier ?? 'free',
      trialEndsAt: data.trialEndsAt ? new Date(data.trialEndsAt) : null,
      paymentGraceUntil: data.paymentGraceUntil ? new Date(data.paymentGraceUntil) : null,
      yocoCustomerId: data.yocoCustomerId ?? null,
      isActive: data.isActive ?? true,
    },
  })
  return businessFromPrisma(row)
}

export async function updateBusiness(
  businessId: string,
  data: Partial<Omit<BusinessAccount, 'businessId' | 'createdAt'>>,
): Promise<BusinessAccount | null> {
  const update: Record<string, unknown> = {}
  if (data.email !== undefined) update['email'] = data.email
  if (data.phone !== undefined) update['phone'] = data.phone
  if (data.businessName !== undefined) update['businessName'] = data.businessName
  if (data.registrationNumber !== undefined) update['registrationNumber'] = data.registrationNumber
  if (data.cognitoSub !== undefined) update['cognitoSub'] = data.cognitoSub
  if (data.tier !== undefined) update['tier'] = data.tier
  if (data.trialEndsAt !== undefined)
    update['trialEndsAt'] = data.trialEndsAt ? new Date(data.trialEndsAt) : null
  if (data.paymentGraceUntil !== undefined)
    update['paymentGraceUntil'] = data.paymentGraceUntil ? new Date(data.paymentGraceUntil) : null
  if (data.yocoCustomerId !== undefined) update['yocoCustomerId'] = data.yocoCustomerId
  if (data.isActive !== undefined) update['isActive'] = data.isActive

  if (Object.keys(update).length === 0) return getBusinessById(businessId)

  try {
    const row = await prisma.businessAccount.update({ where: { id: businessId }, data: update })
    return businessFromPrisma(row)
  } catch {
    return null
  }
}

// ============================================================================
// STAFF ACCOUNT OPERATIONS
// ============================================================================

export async function getStaffById(staffId: string): Promise<StaffAccount | null> {
  const row = await prisma.staffAccount.findUnique({ where: { id: staffId } })
  return row ? staffFromPrisma(row) : null
}

export async function getStaffByCognitoSub(cognitoSub: string): Promise<StaffAccount | null> {
  const row = await prisma.staffAccount.findUnique({ where: { cognitoSub } })
  return row ? staffFromPrisma(row) : null
}

export async function getStaffByPhone(phone: string): Promise<StaffAccount | null> {
  const row = await prisma.staffAccount.findUnique({ where: { phone } })
  return row ? staffFromPrisma(row) : null
}

export async function createStaff(
  data: Omit<StaffAccount, 'staffId' | 'createdAt'>,
): Promise<StaffAccount> {
  if (!data.cognitoSub && !data.phone) {
    throw new Error('createStaff requires cognitoSub or phone')
  }
  const row = await prisma.staffAccount.create({
    data: {
      businessId: data.businessId,
      name: data.name,
      // Schema requires phone non-null; supply a synthetic placeholder for
      // OAuth-only staff so legacy unique-on-phone constraint holds.
      phone: data.phone ?? `oauth:${data.cognitoSub}`,
      cognitoSub: data.cognitoSub ?? null,
      isActive: data.isActive ?? true,
    },
  })
  return staffFromPrisma(row)
}

export async function getStaffByBusinessId(businessId: string): Promise<StaffAccount[]> {
  const rows = await prisma.staffAccount.findMany({
    where: { businessId },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(staffFromPrisma)
}
