import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton.
 *
 * In Lambda, each cold start creates a new client. The singleton pattern
 * ensures we reuse the same client across warm invocations within the
 * same container. In ECS/long-running processes, the single instance
 * is shared across all requests.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env['AREA_CODE_ENV'] === 'dev'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env['AREA_CODE_ENV'] !== 'prod') {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient };
