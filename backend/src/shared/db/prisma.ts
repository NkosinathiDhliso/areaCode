import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const hasDbUrl = !!process.env['AREA_CODE_DB_URL']

export const prisma: PrismaClient = hasDbUrl
  ? (globalForPrisma.prisma ??
    new PrismaClient({
      log:
        process.env['AREA_CODE_ENV'] === 'dev'
          ? ['query', 'warn', 'error']
          : ['warn', 'error'],
    }))
  : (new Proxy({} as PrismaClient, {
      get(_target, prop) {
        // Return a model-like proxy for any table access
        return new Proxy({}, {
          get() {
            return async () => {
              throw new Error(`[prisma-mock] DB unavailable (no AREA_CODE_DB_URL). Called ${String(prop)}`)
            }
          },
        })
      },
    }))

if (process.env['AREA_CODE_ENV'] !== 'prod' && hasDbUrl) {
  globalForPrisma.prisma = prisma
}

export const isDbAvailable = hasDbUrl

export type { PrismaClient }
