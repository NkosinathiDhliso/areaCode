/** Design tokens matching the web app's CSS custom properties (dark theme). */
export const colors = {
  bgBase: '#0c1018',
  bgSurface: 'rgba(18,26,38,0.65)',
  bgRaised: 'rgba(26,36,52,0.70)',
  bgOverlay: 'rgba(8,10,14,0.80)',
  bgChip: 'rgba(18,18,24,0.85)',
  bgTabBar: 'rgba(18,18,24,0.85)',

  textPrimary: '#e8ecf0',
  textSecondary: '#9aa8b8',
  textMuted: '#5c6878',
  textOnAccent: '#ffffff',

  accent: '#778CA9',
  accentBright: '#A9CBE0',
  accentDim: '#5A6F8A',
  success: '#22d3a0',
  successSubtle: 'rgba(16,185,129,0.1)',
  warning: '#ffb830',
  warningSubtle: 'rgba(245,158,11,0.2)',
  danger: '#ff4757',
  dangerSubtle: 'rgba(239,68,68,0.2)',
  dangerBorder: 'rgba(239,68,68,0.3)',

  border: 'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(255,255,255,0.12)',

  tierLocal: '#5c6878',
  tierRegular: '#cd7f32',
  tierFixture: '#c0c0c0',
  tierInstitution: '#ffd700',
} as const
