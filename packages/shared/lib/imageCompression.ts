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

/**
 * Downscale and re-encode an image `File` to JPEG in the browser.
 *
 * Decodes with `createImageBitmap({ imageOrientation: 'from-image' })` so EXIF
 * orientation is baked into the pixels (and then discarded with the rest of the
 * metadata). Returns a new `File` (`image/jpeg`). Throws on decode/encode
 * failure so the caller can surface an honest error rather than silently
 * uploading a huge original (see `no-fallbacks-no-legacy.md`).
 */
export async function compressImageFile(
  file: File,
  maxDimension: number = HEADER_IMAGE_MAX_DIMENSION,
  quality: number = HEADER_IMAGE_QUALITY,
): Promise<File> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    throw new Error('Image compression is not supported in this browser.')
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { width, height } = computeTargetDimensions(bitmap.width, bitmap.height, maxDimension)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get a 2D canvas context for compression.')
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, COMPRESSED_IMAGE_TYPE, quality)
    })
    if (!blob) throw new Error('Image encoding failed.')

    const baseName = file.name.replace(/\.[^./\\]+$/, '') || 'photo'
    return new File([blob], `${baseName}.jpg`, { type: COMPRESSED_IMAGE_TYPE })
  } finally {
    bitmap.close()
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
