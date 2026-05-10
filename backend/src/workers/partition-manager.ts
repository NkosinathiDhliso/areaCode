/**
 * Partition manager — keeps the `check_ins` time-partitioned table
 * supplied with future monthly partitions.
 *
 * Schedule: monthly via EventBridge (e.g. cron(0 4 1 * ? *)).
 * Each invocation ensures partitions exist for [today .. today + 3 months]
 * by calling the SQL helper `ensure_check_ins_partition(date)`.
 *
 * Using `ensure_check_ins_partition` (CREATE TABLE IF NOT EXISTS internally)
 * makes this idempotent and safe to invoke at any frequency.
 */
import { prisma } from '../shared/db/prisma.js'

export async function handler(): Promise<{ created: number; months: string[] }> {
  const months: string[] = []

  // Run with a generous timeout — 12 partition creates × DDL is ~seconds total.
  for (let i = 0; i <= 3; i++) {
    const target = new Date()
    target.setUTCDate(1)
    target.setUTCHours(0, 0, 0, 0)
    target.setUTCMonth(target.getUTCMonth() + i)
    const iso = target.toISOString().slice(0, 10)
    await prisma.$executeRawUnsafe(`SELECT ensure_check_ins_partition($1::date)`, iso)
    months.push(iso)
  }

  console.log('[partition-manager] ensured partitions for', months.join(', '))
  return { created: months.length, months }
}
