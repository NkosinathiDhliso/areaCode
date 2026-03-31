/**
 * Mock layer utility functions.
 * No external dependencies — pure JS helpers for data generation and time manipulation.
 */

/** Returns a random integer between min and max inclusive. */
export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/** Returns a Promise that resolves after a random 100–400ms delay. */
export function mockDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, randomBetween(100, 400)))
}

/** Returns a UUID-like string (v4 format). */
export function generateId(): string {
  const hex = () => randomBetween(0, 15).toString(16)
  const seg = (len: number) => Array.from({ length: len }, hex).join('')
  return `${seg(8)}-${seg(4)}-4${seg(3)}-${(randomBetween(8, 11)).toString(16)}${seg(3)}-${seg(12)}`
}

/** Returns a redemption code in "AC-XXXXX-NNNN" format (X = uppercase letter, N = digit). */
export function generateRedemptionCode(): string {
  const letter = () => String.fromCharCode(randomBetween(65, 90))
  const digit = () => randomBetween(0, 9).toString()
  const letters = Array.from({ length: 5 }, letter).join('')
  const digits = Array.from({ length: 4 }, digit).join('')
  return `AC-${letters}-${digits}`
}

/** Returns an ISO timestamp string n hours in the past. */
export function hoursAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 60 * 1000).toISOString()
}

/** Returns an ISO timestamp string n days in the future. */
export function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString()
}
