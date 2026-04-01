import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lambda-compatible migration runner.
 *
 * Runs `prisma migrate deploy` which applies all pending migrations
 * from the migrations directory. Safe to call on every cold start —
 * Prisma tracks applied migrations in the `_prisma_migrations` table
 * and skips already-applied ones.
 *
 * Usage:
 *   import { runMigrations } from './migration-runner.js';
 *   await runMigrations();
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const prismaDir = resolve(__dirname, '../../..', 'prisma');

export async function runMigrations(): Promise<void> {
  const dbUrl = process.env['AREA_CODE_DB_URL'];
  if (!dbUrl) {
    throw new Error('AREA_CODE_DB_URL environment variable is not set');
  }

  try {
    console.log('[migration-runner] Running prisma migrate deploy...');
    execSync('npx prisma migrate deploy', {
      cwd: prismaDir,
      env: { ...process.env, DATABASE_URL: dbUrl, AREA_CODE_DB_URL: dbUrl },
      stdio: 'pipe',
      timeout: 60_000, // 60s timeout for Lambda
    });
    console.log('[migration-runner] Migrations applied successfully');
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown migration error';
    console.error('[migration-runner] Migration failed:', message);
    throw new Error(`Migration failed: ${message}`);
  }
}
