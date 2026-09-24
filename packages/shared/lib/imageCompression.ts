/**
 * Browser-side image compression for venue header uploads.
 *
 * Why this exists: the API Lambda does not carry the `sharp` native binary
 * (it is marked external in the Lambda build and there is no image-processing
 * worker), so the server cannot downsize uploads. Compressing in the browser is
 * the single serving path that keeps stored/served bytes small on a
 * pay-per-use serverless budget, and lets owners pick full HD phone photos
 * without a stingy raw-size cap.
 *
 * Re-encoding through a canvas also drops all EXIF metadata (including GPS),
 * which is the POPIA posture we want for user-supplied photos.
 */

/** Target longest-edge dimension for a compressed header image (px). */
export const HEADER_IMAGE_MAX_DIMENSION = 1600

/** JPEG quality for the compressed output (0..1). */
export const HEADER_IMAGE_QUALITY = 0.82

/** MIME type of the compressed output. */
export const COMPRESSED_IMAGE_TYPE = 'image/jpeg'

/**
 * Compute the output dimensions that fit within `maxDimension` on the longest
 * edge while preserving aspect ratio. Never enlarges: an image already within
 * the bound is returned unchanged. Pure function, unit-tested.
 */
export function computeTargetDimensions(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const longest = Math.max(width, height)
  if (longest <= maxDimension) return { width, height }
  const scale = maxDimension / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Formats the byte sniff can name. Anything else reads `unknown`. */
export type SniffedImageFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'unknown'

/** Bytes the sniff needs: RIFF/WEBP and ISO-BMFF `ftyp` brands both end at 12. */
export const IMAGE_SNIFF_BYTES = 12

/** HEIC/HEIF `ftyp` brands we treat as HEIC (R14.1). */
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'mif1']

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = offset; i < offset + length; i += 1) out += String.fromCharCode(bytes[i] ?? 0)
  return out
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false
  return magic.every((byte, i) => bytes[i] === byte)
}

/**
 * Classify a leading byte prefix by magic number. Pure, total, deterministic.
 *
 * A phone picker is an unreliable narrator: Android reports `''` or
 * `application/octet-stream`, iOS High Efficiency reports `image/heic` for a
 * file named `.jpg`. The bytes are the only honest source, so this is the gate
 * and `File.type` is ignored entirely (R14.1).
 *
 * GIF, BMP, TIFF and anything else read `unknown`: they are real formats we do
 * not accept, and saying so is the honest answer.
 */
export function classifyImageMagicBytes(bytes: Uint8Array): SniffedImageFormat {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png'
  if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return 'webp'
  if (bytes.length >= 12 && asciiAt(bytes, 4, 4) === 'ftyp' && HEIC_BRANDS.includes(asciiAt(bytes, 8, 4))) {
    return 'heic'
  }
  return 'unknown'
}

/**
 * Read the first {@link IMAGE_SNIFF_BYTES} bytes of a file and name its format.
 *
 * Thin async shell over {@link classifyImageMagicBytes} so the classification
 * stays pure and property-tested.
 */
export async function sniffImageFormat(file: Blob): Promise<SniffedImageFormat> {
  const head = await file.slice(0, IMAGE_SNIFF_BYTES).arrayBuffer()
  return classifyImageMagicBytes(new Uint8Array(head))
}

/** Thrown when the browser cannot decode the selected photo. */
export class ImageDecodeError extends Error {
  override readonly name = 'ImageDecodeError'
}

/** Thrown when the canvas produced no bytes for the compressed output. */
export class ImageEncodeError extends Error {
  override readonly name = 'ImageEncodeError'
}

/**
 * Decode a blob URL through an `<img>` element.
 *
 * One decode path for every target (iOS Safari, Android Chrome, desktop):
 * `createImageBitmap` is missing or unreliable in mobile Safari and older
 * Android WebViews, and cannot decode HEIC at all. Browsers apply EXIF
 * orientation when drawing an `<img>` (Safari 13.4, Chrome 81), so the old
 * `imageOrientation: 'from-image'` hint is not needed. `decode()` is required,
 * not probed: a browser without it gets a clear message rather than a second
 * code path (R14.4, `no-fallbacks-no-legacy.md`).
 */
async function decodeObjectUrl(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  if (typeof img.decode !== 'function') {
    throw new ImageDecodeError('This browser cannot decode photos for upload.')
  }
  img.src = url
  try {
    await img.decode()
  } catch (err) {
    throw new ImageDecodeError((err as Error)?.message ?? 'decode failed')
  }
  return img
}

/**
 * Downscale and re-encode an image `File` to JPEG in the browser.
 *
 * Decodes via `URL.createObjectURL` + `<img>.decode()`, draws to a canvas and
 * re-encodes as JPEG, which also drops all EXIF metadata (including GPS). The
 * object URL is revoked in `finally` so a rejected decode leaks nothing.
 *
 * Throws {@link ImageDecodeError} / {@link ImageEncodeError} so the caller can
 * surface an honest, specific error. It never returns the original file and
 * never returns empty bytes (see `no-fallbacks-no-legacy.md`).
 */
export async function compressImageFile(
  file: File,
  maxDimension: number = HEADER_IMAGE_MAX_DIMENSION,
  quality: number = HEADER_IMAGE_QUALITY,
): Promise<File> {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    throw new ImageDecodeError('Image compression is not supported in this browser.')
  }

  const url = URL.createObjectURL(file)
  try {
    const img = await decodeObjectUrl(url)
    const { width, height } = computeTargetDimensions(img.naturalWidth, img.naturalHeight, maxDimension)
    if (width === 0 || height === 0) throw new ImageDecodeError('Decoded image has no pixels.')

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImageEncodeError('Could not get a 2D canvas context for compression.')
    ctx.drawImage(img, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, COMPRESSED_IMAGE_TYPE, quality)
    })
    if (!blob || blob.size === 0) throw new ImageEncodeError('Image encoding failed.')

    const baseName = file.name.replace(/\.[^./\\]+$/, '') || 'photo'
    return new File([blob], `${baseName}.jpg`, { type: COMPRESSED_IMAGE_TYPE })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Maximum size of the source image a user may select for a header photo.
 *
 * This caps the raw input only to avoid decoding an absurdly large file (which
 * would risk an out-of-memory on a low-end device). It is deliberately generous
 * so full HD phone photos are accepted; `compressImageFile` downscales and
 * re-encodes before upload, so the bytes actually stored and served stay small.
 * Single source of truth for the cap and its copy.
 */
export const MAX_HEADER_IMAGE_BYTES = 25 * 1024 * 1024

/** Human label for {@link MAX_HEADER_IMAGE_BYTES}, used in validation copy. */
export const MAX_HEADER_IMAGE_LABEL = '25MB'

/** The cause of a header-photo upload failure, one per copy line. */
export type UploadFailureKind = 'format' | 'heic-decode' | 'decode' | 'too-large' | 'network' | 'server' | 'unknown'

/**
 * Owner-facing copy per failure cause. Single source of truth: the panel renders
 * these strings and the tests assert against them, so the message a phone shows
 * can never drift from the message we verify (R14.3, R14.5).
 *
 * A raw `err.message` is never shown. A `DOMException` string tells an owner
 * nothing they can act on; each line below names the next action.
 */
export const UPLOAD_ERROR_COPY: Record<UploadFailureKind, string> = {
  format: "That file isn't a photo we can use. Pick a JPG or PNG.",
  'heic-decode':
    "This photo format can't be read in this browser. In your camera settings choose Most Compatible, or pick a JPG.",
  decode: "This photo couldn't be read. Try a smaller one.",
  'too-large': `Image must be under ${MAX_HEADER_IMAGE_LABEL}.`,
  network: 'Upload blocked. Open the portal at business.areacode.co.za and try again.',
  server: 'Upload failed on our side. Please try again in a moment.',
  unknown: 'Upload failed. Try again, or pick a different photo.',
}

function readStatusCode(err: unknown): number | null {
  const code = (err as { statusCode?: unknown })?.statusCode
  return typeof code === 'number' && Number.isFinite(code) ? code : null
}

function isNetworkFailure(err: unknown): boolean {
  // A blocked presigned PUT (S3 CORS mismatch) rejects `fetch` with a TypeError
  // whose message varies by engine: "Failed to fetch" (Chrome), "Load failed"
  // (Safari), "NetworkError ..." (Firefox). The shared API client normalises its
  // own connectivity failures to `statusCode: 0`.
  if (readStatusCode(err) === 0) return true
  const message = (err as { message?: unknown })?.message
  if (typeof message !== 'string') return false
  return /failed to fetch|load failed|networkerror|network request failed/i.test(message)
}

/**
 * Classify an upload failure. Pure; exported for the per-branch unit tests.
 *
 * `format` is the sniff gate's own verdict, so it is passed in rather than
 * guessed: a HEIC the browser refuses to decode must say so specifically
 * instead of reading as a generic "couldn't be read" (R14.3).
 */
export function classifyUploadFailure(err: unknown, format: SniffedImageFormat = 'unknown'): UploadFailureKind {
  const status = readStatusCode(err)
  if (status === 413) return 'too-large'
  if (isNetworkFailure(err)) return 'network'
  if (status !== null && status >= 400) return 'server'

  const name = (err as { name?: unknown })?.name
  // `img.decode()` rejects with a bare DOMException ("The source image could not
  // be decoded") that must never reach an owner verbatim.
  const isDomException = typeof DOMException !== 'undefined' && err instanceof DOMException
  if (err instanceof ImageDecodeError || name === 'ImageDecodeError' || isDomException) {
    return format === 'heic' ? 'heic-decode' : 'decode'
  }
  if (err instanceof ImageEncodeError || name === 'ImageEncodeError') return 'decode'

  return 'unknown'
}

/** Map an upload failure to the one line an owner should read. */
export function mapUploadError(err: unknown, format: SniffedImageFormat = 'unknown'): string {
  return UPLOAD_ERROR_COPY[classifyUploadFailure(err, format)]
}
