/**
 * Privacy types for the Area Code platform.
 * Privacy is a data-layer concern — every data flow that exposes user activity
 * must check the user's privacy level before any data leaves the service layer.
 */

export type PrivacyLevel = 'public' | 'friends_only' | 'private'

export const DEFAULT_PRIVACY_LEVEL: PrivacyLevel = 'friends_only'

/**
 * Result of a privacy check for a single user in a social context.
 * Determines what data about this user can be shown to the viewer.
 */
export type PrivacyVisibility =
  | 'full' // Viewer can see all identity fields (own data, or mutual follow with public/friends_only)
  | 'anonymous' // Viewer can see tier and aggregate data but not identity
  | 'excluded' // User is completely hidden from viewer (blocked or private)

export interface PrivacyCheckResult {
  visibility: PrivacyVisibility
  reason: 'own_data' | 'mutual_follow' | 'public_profile' | 'not_friends' | 'private_profile' | 'blocked'
}
