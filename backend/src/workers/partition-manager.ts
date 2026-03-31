import { prisma } from '../shared/db/prisma.js'
import { Prisma } from '@prisma/client'

/**
 * Partition manager — monthly Lambda creating check_ins partitions
 * one month ahead. Idempotent via IF NOT EXISTS.
 */
export async function handler() {
  console.log('[partition-manager] Creating upcoming check_ins partitions')

  const now = new Date()
  let created = 0

  // Create partitions for current month + next 2 months
  for (let offset = 0; offset <= 2; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1)

    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const partitionName = `check_ins_${year}_${month}`

    const fromDate = date.toISOString().split('T')[0]
    const toDate = nextMonth.toISOString().split('T')[0]

    try {
      await prisma.$executeRaw(Prisma.sql`
        CREATE TABLE IF NOT EXISTS ${Prisma.raw(partitionName)}
        PARTITION OF check_ins
        FOR VALUES FROM (${Prisma.raw(`'${fromDate}'`)}) TO (${Prisma.raw(`'${toDate}'`)})
      `)
      created++
      console.log(`[partition-manager] Created/verified ${partitionName}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Partition already exists — safe to ignore
      if (!msg.includes('already exists')) {
        console.error(`[partition-manager] Failed: ${partitionName}: ${msg}`)
      }
    }
  }

  console.log(`[partition-manager] Done. Partitions created/verified: ${created}`)
  return { created }
}
