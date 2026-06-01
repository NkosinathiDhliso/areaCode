/** Design tokens matching the web app's CSS custom properties (dark theme). */
export const colors = {
  bgBase: '#0c1018',
  bgSurface: 'rgba(18,26,38,0.65)',
  bgRaised: 'rgba(26,36,52,0.70)',
  bgOverlay: 'rgba(8,10,14,0.80)',

  textPrimary: '#e8ecf0',
  textSecondary: '#9aa8b8',
  textMuted: '#5c6878',

  accent: '#778CA9',
  accentBright: '#A9CBE0',
  accentDim: '#5A6F8A',
  success: '#22d3a0',
  warning: '#ffb830',
  danger: '#ff4757',

  border: 'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(255,255,255,0.12)',

  tierLocal: '#5c6878',
  tierRegular: '#cd7f32',
  tierFixture: '#c0c0c0',
  tierInstitution: '#ffd700',
} as const

/** Node category hex colours (mirrors apps/web getCategoryColour). */
const CATEGORY_HEX: Record<string, string> = {
  food: '#ff6b6b',
  coffee: '#a0785a',
  nightlife: '#3B7DD8',
  retail: '#38bdf8',
  fitness: '#22d3a0',
  arts: '#ff9f43',
}

export function getCategoryColour(category: string): string {
  return CATEGORY_HEX[category] ?? colors.accent
}
