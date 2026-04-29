// Helper to generate UUID-like IDs
export function generateId(): string {
  return crypto.randomUUID()
}
