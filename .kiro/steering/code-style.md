<!-- GENERATED FILE. DO NOT EDIT.
     Single source of truth: rules/*.md
     Regenerate with: pnpm sync:rules -->

# Code, styling, and writing standards

## Writing rules (docs and UI copy)

- Never use em dashes. Use commas, periods, or restructure the sentence.
- Never use emojis in system UI (nav, headings, buttons, labels).
- Keep comments short. No filler words.
- No superlatives or hyperbole in docs or UI copy.

## Code limits

| Metric      | Warning | Hard limit |
| ----------- | ------- | ---------- |
| File size   | 300     | 400 lines  |
| Function    | 30      | 150 lines  |
| Component   | 200     | 300 lines  |
| Line length | 100     | 120 chars  |

## Styling rules

- All colors via CSS variables. Never use Tailwind color classes directly
  (no `bg-red-500`, `text-green-400`, etc.). Use tokens like `var(--accent)`,
  `var(--text-secondary)`, `var(--border)`.
- Cards: `rounded-2xl`. Bottom sheets: `rounded-t-3xl`. Inputs: `rounded-xl`
  with `focus:border-[var(--accent)]`.
- No CSS grid in shared components (breaks React Native). Flex only.
- Buttons: `active:scale-95` for tactile feedback.
- Map fills 100dvh x 100dvw. No vertical scroll on the map screen. Avoid `100vh`
  / `h-screen` (mobile browser-chrome cutoff); use `dvh`.
- Respect safe areas: use `env(safe-area-inset-top)` /
  `env(safe-area-inset-bottom)` for top and bottom overlays.
- Touch targets are at least 44px (`w-11 h-11`) for interactive controls.
  Decorative badges are exempt.

## Code rules

- Hooks above all conditional returns.
- Disable buttons during API calls with a loading state.
- Clean up useEffect subscriptions on unmount.
- Check `statusCode` on API errors and show specific messages.
- One component per file.
- No `any` in component props.
- No inline business logic in components.
- No mock data in production. All synthetic/hardcoded data returns must be inside
  a `DEV_MODE` guard. Never add mock fallbacks that run in production (see
  `no-fallbacks-no-legacy.md`).

## Reuse and source of truth

Search before you create, edit in place, and never fork a parallel
`foo2.ts` / `*-legacy` / `*-old` variant. One home per concept. See
`dry-reuse-no-duplication.md` and `no-fallbacks-no-legacy.md`.
