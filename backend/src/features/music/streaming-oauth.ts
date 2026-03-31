/**
 * Spotify and Apple Music OAuth integration.
 *
 * Spotify flow:
 *   1. Frontend calls GET /v1/streaming/spotify/authorize → returns redirect URL
 *   2. User authorizes on Spotify → redirected to callback URL with ?code=
 *   3. Backend exchanges code for access token → fetches top artists → extracts genres
 *
 * Apple Music flow:
 *   1. Frontend obtains a MusicKit user token via MusicKit JS SDK
 *   2. Frontend sends the user token to POST /v1/users/me/streaming/connect
 *   3. Backend uses developer token + user token to call Apple Music API → fetches library
 *
 * To set up:
 *   Spotify: https://developer.spotify.com/dashboard → Create App
 *     - Set redirect URI to: https://areacode.co.za/api/v1/streaming/spotify/callback
 *     - Scopes needed: user-top-read
 *
 *   Apple Music: https://developer.apple.com → Certificates, Identifiers & Profiles → Keys → MusicKit
 *     - Generate a MusicKit private key (.p8 file)
 *     - Note your Team ID and Key ID
 */

// ─── Spotify ────────────────────────────────────────────────────────────────

const SPOTIFY_CLIENT_ID = process.env['SPOTIFY_CLIENT_ID'] ?? ''
const SPOTIFY_CLIENT_SECRET = process.env['SPOTIFY_CLIENT_SECRET'] ?? ''
const SPOTIFY_REDIRECT_URI = process.env['SPOTIFY_REDIRECT_URI'] ?? 'https://areacode.co.za/api/v1/streaming/spotify/callback'
const SPOTIFY_SCOPES = 'user-top-read'

// Known Spotify genre strings → our 12 genre taxonomy
const SPOTIFY_GENRE_MAP: Record<string, string> = {
  'amapiano': 'amapiano',
  'south african house': 'amapiano',
  'deep house': 'deep_house',
  'house': 'deep_house',
  'afrobeats': 'afrobeats',
  'afro house': 'afrobeats',
  'afropop': 'afrobeats',
  'hip hop': 'hip_hop',
  'rap': 'hip_hop',
  'south african hip hop': 'hip_hop',
  'r&b': 'rnb',
  'rnb': 'rnb',
  'neo soul': 'rnb',
  'kwaito': 'kwaito',
  'gqom': 'gqom',
  'jazz': 'jazz',
  'south african jazz': 'jazz',
  'smooth jazz': 'jazz',
  'rock': 'rock',
  'alternative': 'rock',
  'indie': 'rock',
  'pop': 'pop',
  'dance pop': 'pop',
  'gospel': 'gospel',
  'south african gospel': 'gospel',
  'maskandi': 'maskandi',
  'isicathamiya': 'maskandi',
  'zulu music': 'maskandi',
}

export function getSpotifyAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: SPOTIFY_SCOPES,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state,
    show_dialog: 'true',
  })
  return `https://accounts.spotify.com/authorize?${params.toString()}`
}

interface SpotifyTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  scope: string
}

export async function exchangeSpotifyCode(code: string): Promise<SpotifyTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
  })

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Spotify token exchange failed: ${res.status} ${err}`)
  }

  return res.json() as Promise<SpotifyTokenResponse>
}

interface SpotifyArtist {
  name: string
  genres: string[]
}

interface SpotifyTopArtistsResponse {
  items: SpotifyArtist[]
}

export async function fetchSpotifyTopGenres(accessToken: string): Promise<string[]> {
  const res = await fetch('https://api.spotify.com/v1/me/top/artists?limit=20&time_range=medium_term', {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    throw new Error(`Spotify top artists failed: ${res.status}`)
  }

  const data = await res.json() as SpotifyTopArtistsResponse

  // Collect all genre strings from top artists
  const rawGenres: string[] = []
  for (const artist of data.items) {
    rawGenres.push(...artist.genres)
  }

  // Map to our taxonomy and count occurrences
  const counts = new Map<string, number>()
  for (const raw of rawGenres) {
    const lower = raw.toLowerCase()
    // Try exact match first, then partial match
    let mapped = SPOTIFY_GENRE_MAP[lower]
    if (!mapped) {
      for (const [pattern, genre] of Object.entries(SPOTIFY_GENRE_MAP)) {
        if (lower.includes(pattern)) { mapped = genre; break }
      }
    }
    if (mapped) {
      counts.set(mapped, (counts.get(mapped) ?? 0) + 1)
    }
  }

  // Return top 5 by frequency
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre]) => genre)
}

// ─── Apple Music ────────────────────────────────────────────────────────────

const APPLE_TEAM_ID = process.env['APPLE_MUSIC_TEAM_ID'] ?? ''
const APPLE_KEY_ID = process.env['APPLE_MUSIC_KEY_ID'] ?? ''
const APPLE_PRIVATE_KEY = process.env['APPLE_MUSIC_PRIVATE_KEY'] ?? '' // PEM-encoded .p8 key content

/**
 * Generate an Apple Music developer token (JWT).
 * Valid for up to 6 months. In production, cache this and rotate before expiry.
 */
export async function generateAppleDeveloperToken(): Promise<string> {
  if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) {
    throw new Error('Apple Music credentials not configured')
  }

  // Dynamic import jose for JWT signing
  const { SignJWT, importPKCS8 } = await import('jose')

  const privateKey = await importPKCS8(APPLE_PRIVATE_KEY, 'ES256')

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: APPLE_KEY_ID })
    .setIssuer(APPLE_TEAM_ID)
    .setIssuedAt()
    .setExpirationTime('180d')
    .sign(privateKey)

  return token
}

// Apple Music genre name → our taxonomy
const APPLE_GENRE_MAP: Record<string, string> = {
  'Amapiano': 'amapiano',
  'House': 'deep_house',
  'Deep House': 'deep_house',
  'Afrobeats': 'afrobeats',
  'African': 'afrobeats',
  'Hip-Hop/Rap': 'hip_hop',
  'Hip-Hop': 'hip_hop',
  'R&B/Soul': 'rnb',
  'R&B': 'rnb',
  'Soul': 'rnb',
  'Kwaito': 'kwaito',
  'Gqom': 'gqom',
  'Jazz': 'jazz',
  'Rock': 'rock',
  'Alternative': 'rock',
  'Pop': 'pop',
  'Gospel': 'gospel',
  'Christian': 'gospel',
  'Maskandi': 'maskandi',
  'World': 'maskandi',
}

interface AppleMusicSong {
  attributes?: {
    genreNames?: string[]
  }
}

interface AppleMusicLibraryResponse {
  data?: AppleMusicSong[]
}

export async function fetchAppleMusicTopGenres(
  developerToken: string,
  userToken: string,
): Promise<string[]> {
  const res = await fetch(
    'https://api.music.apple.com/v1/me/library/songs?limit=50&sort=-dateAdded',
    {
      headers: {
        'Authorization': `Bearer ${developerToken}`,
        'Music-User-Token': userToken,
      },
    },
  )

  if (!res.ok) {
    throw new Error(`Apple Music library fetch failed: ${res.status}`)
  }

  const data = await res.json() as AppleMusicLibraryResponse

  const counts = new Map<string, number>()
  for (const song of data.data ?? []) {
    for (const genreName of song.attributes?.genreNames ?? []) {
      const mapped = APPLE_GENRE_MAP[genreName]
      if (mapped) {
        counts.set(mapped, (counts.get(mapped) ?? 0) + 1)
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre]) => genre)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function isSpotifyConfigured(): boolean {
  return !!SPOTIFY_CLIENT_ID && !!SPOTIFY_CLIENT_SECRET
}

export function isAppleMusicConfigured(): boolean {
  return !!APPLE_TEAM_ID && !!APPLE_KEY_ID && !!APPLE_PRIVATE_KEY
}
