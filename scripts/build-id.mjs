import { execSync } from 'node:child_process'

/**
 * Build identifier injected into each app via vite `define` (__APP_BUILD_ID__).
 * Prefers Amplify's AWS_COMMIT_ID, falls back to the local git short hash, then
 * to 'dev'. Includes a UTC build timestamp so a stale device build is obvious
 * at a glance. Shared by every app's vite.config so the format stays identical.
 * @returns {string}
 */
export function getBuildId() {
  const time = `${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`
  const commit = process.env.AWS_COMMIT_ID
  if (commit) return `${commit.slice(0, 7)} ${time}`
  try {
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    return `${hash} ${time}`
  } catch {
    return `dev ${time}`
  }
}
