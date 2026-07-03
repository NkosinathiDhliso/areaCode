/**
 * Device-tier heuristic for the map render budget.
 *
 * Runs once synchronously at module load. The result is held for the app's
 * lifetime (no runtime FPS polling, no flip-flopping). Low-tier devices drop
 * cosmetic GPU extras (antialias, cast shadows, terrain exaggeration) but keep
 * the full interaction model (markers, beams, selection) identical.
 *
 * Criteria for low tier (any one triggers):
 *   - hardwareConcurrency <= 4
 *   - devicePixelRatio < 2 on a touch device (mobile with weak screen)
 *   - Known weak GPU renderer strings (WEBGL_debug_renderer_info)
 *
 * This is an accessibility/environment branch (allowed per
 * no-fallbacks-no-legacy.md rule #4), not a fallback.
 */

export type DeviceTier = 'low' | 'high'

/** Weak GPU substrings (case-insensitive). */
const WEAK_GPU_PATTERNS = [
  'mali-4',
  'mali-t',
  'adreno 3',
  'adreno 4',
  'adreno 5',
  'powervr sgx',
  'intel hd graphics 4',
  'intel hd graphics 5',
  'swiftshader',
  'llvmpipe',
  'mesa',
]

function detectGpuRenderer(): string | null {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')
    if (!gl || !(gl instanceof WebGLRenderingContext)) return null
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (!ext) return null
    return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string
  } catch {
    return null
  }
}

function isTouchDevice(): boolean {
  return 'ontouchstart' in globalThis || navigator.maxTouchPoints > 0
}

function computeTier(): DeviceTier {
  // Core count check
  const cores = navigator.hardwareConcurrency ?? 0
  if (cores > 0 && cores <= 4) return 'low'

  // Mobile + low DPR = weak device
  if (isTouchDevice() && window.devicePixelRatio < 2) return 'low'

  // GPU renderer string check
  const renderer = detectGpuRenderer()
  if (renderer) {
    const lower = renderer.toLowerCase()
    for (const pattern of WEAK_GPU_PATTERNS) {
      if (lower.includes(pattern)) return 'low'
    }
  }

  return 'high'
}

/**
 * The device tier, computed once at module load. Import this value wherever the
 * render budget decision is needed. Never re-computed at runtime.
 */
export const deviceTier: DeviceTier = computeTier()
