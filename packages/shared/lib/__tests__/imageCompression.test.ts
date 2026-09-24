import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import {
  classifyImageMagicBytes,
  computeTargetDimensions,
  ImageDecodeError,
  ImageEncodeError,
  mapUploadError,
  sniffImageFormat,
  UPLOAD_ERROR_COPY,
} from '../imageCompression'

// `computeTargetDimensions` is the pure core of header-image compression: it
// decides the output size that fits within a max longest-edge while preserving
// aspect ratio and never enlarging. The DOM canvas encode around it is covered
// by component/e2e tests, not here.

const dimArb = fc.integer({ min: 1, max: 12000 })
const maxArb = fc.integer({ min: 1, max: 4000 })

// Realistic photo dimensions (no 1px degeneracy) for the ratio property, where
// rounding to whole pixels stays negligible.
const photoDimArb = fc.integer({ min: 200, max: 12000 })
const photoMaxArb = fc.integer({ min: 200, max: 4000 })

describe('computeTargetDimensions', () => {
  // Feature: header-image-compression, Property 1: never exceeds the cap
  it('keeps the longest edge within maxDimension', () => {
    fc.assert(
      fc.property(dimArb, dimArb, maxArb, (w, h, max) => {
        const out = computeTargetDimensions(w, h, max)
        expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(max)
      }),
      { numRuns: 200 },
    )
  })

  // Feature: header-image-compression, Property 2: never enlarges
  it('returns the original size when already within the cap', () => {
    fc.assert(
      fc.property(dimArb, dimArb, maxArb, (w, h, max) => {
        fc.pre(Math.max(w, h) <= max)
        const out = computeTargetDimensions(w, h, max)
        expect(out).toEqual({ width: w, height: h })
      }),
      { numRuns: 200 },
    )
  })

  // Feature: header-image-compression, Property 3: preserves aspect ratio
  it('preserves the aspect ratio within a rounding tolerance', () => {
    fc.assert(
      fc.property(photoDimArb, photoDimArb, photoMaxArb, (w, h, max) => {
        const out = computeTargetDimensions(w, h, max)
        const sourceRatio = w / h
        const outRatio = out.width / out.height
        // Rounding to whole pixels can shift the ratio; tolerance scales with
        // how small the smaller output edge is (± ~1px of rounding).
        const tolerance = Math.max(0.05, 2 / Math.min(out.width, out.height))
        expect(Math.abs(outRatio - sourceRatio)).toBeLessThanOrEqual(sourceRatio * tolerance)
      }),
      { numRuns: 200 },
    )
  })

  it('returns zeroes for non-positive input', () => {
    expect(computeTargetDimensions(0, 100, 800)).toEqual({ width: 0, height: 0 })
    expect(computeTargetDimensions(100, 0, 800)).toEqual({ width: 0, height: 0 })
  })

  it('downscales a landscape HD photo to the cap', () => {
    expect(computeTargetDimensions(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
  })
})

// ─── Byte-sniff fixtures (R14.1) ────────────────────────────────────────────
//
// Real leading bytes, not MIME labels. The deliberate mismatch between each
// fixture's `type`/extension and its content is the bug: a phone hands us a
// HEIC named `.jpg`, or a JPEG with an empty `type`.

function fileOf(bytes: number[], name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0))

const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0x00, 0x01]
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]
const WEBP_BYTES = [...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WEBPVP8 ')]
const HEIC_BYTES = [0x00, 0x00, 0x00, 0x20, ...ascii('ftypheic'), 0x00, 0x00, 0x00, 0x00]
const GIF_BYTES = [...ascii('GIF89a'), 0x01, 0x00, 0x01, 0x00, 0x80, 0x00]
const TEXT_BYTES = ascii('not an image at all, just prose')

describe('sniffImageFormat', () => {
  it('names JPEG from its bytes even when the picker reports no type', async () => {
    expect(await sniffImageFormat(fileOf(JPEG_BYTES, 'IMG_0001.jpg', ''))).toBe('jpeg')
  })

  it('names PNG from its bytes', async () => {
    expect(await sniffImageFormat(fileOf(PNG_BYTES, 'screenshot.png', 'application/octet-stream'))).toBe('png')
  })

  it('names WebP from RIFF....WEBP', async () => {
    expect(await sniffImageFormat(fileOf(WEBP_BYTES, 'share.webp', ''))).toBe('webp')
  })

  it('names HEIC from the ftyp brand even when the file is named .jpg', async () => {
    expect(await sniffImageFormat(fileOf(HEIC_BYTES, 'IMG_0002.jpg', 'image/jpeg'))).toBe('heic')
  })

  it('reads GIF as unknown: a real format we do not accept', async () => {
    expect(await sniffImageFormat(fileOf(GIF_BYTES, 'meme.gif', 'image/gif'))).toBe('unknown')
  })

  it('reads a non-image as unknown even when it claims to be a JPEG', async () => {
    expect(await sniffImageFormat(fileOf(TEXT_BYTES, 'notes.jpg', 'image/jpeg'))).toBe('unknown')
  })

  it('reads an empty file as unknown', async () => {
    expect(await sniffImageFormat(fileOf([], 'empty.jpg', 'image/jpeg'))).toBe('unknown')
  })

  it('rejects a truncated RIFF header that never reaches the WEBP tag', async () => {
    expect(await sniffImageFormat(fileOf([...ascii('RIFF'), 0x24, 0x00], 'short.webp', ''))).toBe('unknown')
  })

  it('reads an unlisted ftyp brand as unknown', async () => {
    const mp4 = [0x00, 0x00, 0x00, 0x20, ...ascii('ftypisom'), 0x00, 0x00, 0x00, 0x00]
    expect(await sniffImageFormat(fileOf(mp4, 'clip.mp4', 'video/mp4'))).toBe('unknown')
  })
})

describe('classifyImageMagicBytes', () => {
  const MAGIC_BY_FORMAT: Record<'jpeg' | 'png' | 'webp' | 'heic', (b: Uint8Array) => boolean> = {
    jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
    webp: (b) => b.length >= 12 && str(b, 0, 4) === 'RIFF' && str(b, 8, 4) === 'WEBP',
    heic: (b) => b.length >= 12 && str(b, 4, 4) === 'ftyp' && ['heic', 'heix', 'hevc', 'mif1'].includes(str(b, 8, 4)),
  }

  function str(bytes: Uint8Array, offset: number, length: number): string {
    return Array.from(bytes.slice(offset, offset + length), (c) => String.fromCharCode(c)).join('')
  }

  // Feature: Proof of demand, Property 9: deterministic, magic-backed
  // classification of any byte prefix
  // **Validates: Requirements 14.1, 14.2**
  it('classifies any byte prefix deterministically and never names a format without its magic', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 24 }), (bytes) => {
        const first = classifyImageMagicBytes(bytes)
        expect(classifyImageMagicBytes(bytes)).toBe(first)
        if (first !== 'unknown') {
          expect(MAGIC_BY_FORMAT[first](bytes)).toBe(true)
        }
      }),
      { numRuns: 500 },
    )
  })

  it('ignores bytes past the sniff window', () => {
    const padded = new Uint8Array([...JPEG_BYTES, ...Array(400).fill(0x00)])
    expect(classifyImageMagicBytes(padded)).toBe('jpeg')
  })
})

// ─── Upload failure copy (R14.3, R14.5) ─────────────────────────────────────

describe('mapUploadError', () => {
  it('names the Most Compatible setting when a HEIC fails to decode', () => {
    const copy = mapUploadError(new ImageDecodeError('The source image could not be decoded'), 'heic')
    expect(copy).toBe(UPLOAD_ERROR_COPY['heic-decode'])
    expect(copy).toContain('Most Compatible')
  })

  it('asks for a smaller photo when a non-HEIC fails to decode', () => {
    expect(mapUploadError(new ImageDecodeError('out of memory'), 'jpeg')).toBe(UPLOAD_ERROR_COPY.decode)
  })

  it('treats a bare DOMException from decode() as a decode failure', () => {
    const err = new DOMException('The source image could not be decoded', 'EncodingError')
    expect(mapUploadError(err, 'png')).toBe(UPLOAD_ERROR_COPY.decode)
  })

  it('maps an encode failure to the decode line', () => {
    expect(mapUploadError(new ImageEncodeError('Image encoding failed.'), 'jpeg')).toBe(UPLOAD_ERROR_COPY.decode)
  })

  it('maps a blocked presigned PUT to the apex-host instruction', () => {
    expect(mapUploadError(new TypeError('Failed to fetch'), 'jpeg')).toBe(UPLOAD_ERROR_COPY.network)
    expect(mapUploadError(new TypeError('Load failed'), 'jpeg')).toBe(UPLOAD_ERROR_COPY.network)
    expect(mapUploadError({ statusCode: 0, message: 'offline' }, 'jpeg')).toBe(UPLOAD_ERROR_COPY.network)
  })

  it('maps a 413 to the size line and other HTTP failures to the server line', () => {
    expect(mapUploadError({ statusCode: 413 }, 'jpeg')).toBe(UPLOAD_ERROR_COPY['too-large'])
    expect(mapUploadError({ statusCode: 403 }, 'jpeg')).toBe(UPLOAD_ERROR_COPY.server)
    expect(mapUploadError({ statusCode: 500 }, 'jpeg')).toBe(UPLOAD_ERROR_COPY.server)
  })

  it('never returns a raw error message', () => {
    const secret = 'DOMException: InvalidStateError at ImageDecoder'
    const lines = Object.values(UPLOAD_ERROR_COPY)
    for (const err of [new Error(secret), { statusCode: 502, message: secret }, new TypeError('Failed to fetch')]) {
      const copy = mapUploadError(err, 'jpeg')
      expect(copy).not.toContain(secret)
      expect(lines).toContain(copy)
    }
  })
})
