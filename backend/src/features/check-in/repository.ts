import { prisma } from '../../shared/db/prisma.js'
import { Prisma } from '@prisma/client'

export async function getNodeWithCity(nodeId: string) {
  return prisma.node.findUnique({
    where: { id: nodeId },
    select: {
      id: true, lat: true, lng: true, name: true,
      cityId: true, qrCheckinEnabled: true, businessId: true,
      city: { select: { id: true, slug: true } },
    },
  })
}

export async function checkProximity(
  nodeId: string, lat: number, lng: number, radiusMetres: number,
): Promise<boolean> {
  const result = await prisma.$queryRaw<Array<{ within: boolean }>>(
    Prisma.sql`
      SELECT ST_DWithin(
        n.location::geography,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        ${radiusMetres}
      ) AS within
      FROM nodes n WHERE n.id = ${nodeId}::uuid
    `,
  )
  return result[0]?.within ?? false
}

export async function insertCheckIn(data: {
  userId: string; nodeId: string; type: string; neighbourhoodId?: string;
}) {
  return prisma.checkIn.create({
    data: {
      userId: data.userId,
      nodeId: data.nodeId,
      type: data.type,
      neighbourhoodId: data.neighbourhoodId ?? null,
    },
  })
}
