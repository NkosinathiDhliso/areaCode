import { prisma } from '../../shared/db/prisma.js'
import type { Prisma } from '@prisma/client'

export async function updateUserGenres(
  userId: string,
  musicGenres: string[],
  dimensionScores: Record<string, number> | null,
  archetypeId: string,
) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      musicGenres,
      dimensionScores: dimensionScores as Prisma.InputJsonValue ?? Prisma.JsonNull,
      archetypeId,
    },
    select: { id: true, musicGenres: true, dimensionScores: true, archetypeId: true },
  })
}

export async function updateStreamingProvider(userId: string, provider: string | null) {
  return prisma.user.update({
    where: { id: userId },
    data: { streamingProvider: provider },
    select: { id: true, streamingProvider: true },
  })
}

export async function clearUserMusicData(userId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      streamingProvider: null,
      musicGenres: [],
      dimensionScores: Prisma.JsonNull,
      archetypeId: null,
    },
  })
}

export async function getCrowdVibeData(nodeId: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000) // last hour

  const checkIns = await prisma.checkIn.findMany({
    where: { nodeId, checkedInAt: { gte: since } },
    distinct: ['userId'],
    include: {
      user: {
        select: {
          id: true,
          musicGenres: true,
          dimensionScores: true,
          archetypeId: true,
        },
      },
    },
  })

  return checkIns.map((ci) => ci.user)
}

export async function getBusinessAudienceMusicData(businessId: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // last 30 days

  const checkIns = await prisma.checkIn.findMany({
    where: {
      node: { businessId },
      checkedInAt: { gte: since },
    },
    distinct: ['userId'],
    include: {
      user: {
        select: {
          id: true,
          musicGenres: true,
          dimensionScores: true,
          archetypeId: true,
        },
      },
    },
  })

  return checkIns.map((ci) => ci.user)
}
