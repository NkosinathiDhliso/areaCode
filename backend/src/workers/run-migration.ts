import { runMigrations } from '../shared/db/migration-runner.js'

export async function handler(): Promise<{ success: boolean; message: string }> {
  await runMigrations()
  return { success: true, message: 'Migrations applied successfully' }
}
