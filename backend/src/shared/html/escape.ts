/**
 * HTML escaping for the few server-rendered documents this API serves
 * (transactional email bodies, the campaign unsubscribe page, the venue
 * Share_Preview). One home for the escape, imported by every caller, so a fix
 * lands once (`dry-reuse-no-duplication.md`).
 *
 * Escapes the five characters that can break out of either element text or a
 * double- or single-quoted attribute value, so the same function is correct in
 * both positions. Never use it for a `<script>` body or a URL: those need
 * JS/URL-specific encoding, not entity encoding.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
