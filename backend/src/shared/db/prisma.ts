// Prisma singleton — Lambda + long-running server safe.
//
// Pooling strategy:
//   - In Lambda, every container reuses one PrismaClient via a `globalThis` cache.
//   - The DB URL must point to RDS Proxy (port 5432) which handles connection
//     multiplexing across all concurrent Lambdas. Direct RDS connections will
//     exhaust limits at ~50 concurrent Lambdas.
//   - For local dev / tests, AREA_CODE_DB_URL points directly at Postgres.
//
// Logging:
//   - In dev, `query` and `warn` events log to console.
//   - In prod, only `error` to keep logs clean.
import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var __areaCodePrisma: PrismaClient | undefined
}

function buildClient(): PrismaClient {
  const url = process.env['AREA_CODE_DB_URL']
  if (!url) {
    throw new Error('AREA_CODE_DB_URL is not set — set it to the RDS Proxy endpoint URL')
  }

  const isDev = process.env['NODE_ENV'] !== 'production' && process.env['AREA_CODE_ENV'] !== 'prod'

  return new PrismaClient({
    datasources: { db: { url } },
    log: isDev
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : [{ emit: 'event', level: 'error' }],
  })
}

export const prisma: PrismaClient = globalThis.__areaCodePrisma ?? buildClient()

if (process.env['NODE_ENV'] !== 'production') {
  globalThis.__areaCodePrisma = prisma
}

/** For long-running servers only. Lambda should NEVER call this. */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect()
  globalThis.__areaCodePrisma = undefined
}
