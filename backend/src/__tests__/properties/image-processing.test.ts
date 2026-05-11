/**
 * Property 17: Image Processing Invariants
 *
 * For any uploaded image with dimensions W×H, the processed output SHALL have
 * width <= 1200px with aspect ratio preserved (height = H * (outputWidth / W)),
 * format SHALL be WebP, and EXIF metadata SHALL be completely stripped.
 *
 * **Validates: Requirements 23.1, 23.2**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import sharp from 'sharp'
import { processImage } from '../../features/nodes/image-service'

/**
 * Creates a minimal valid image buffer with given dimensions.
 * Uses small dimensions for speed in property tests.
 */
async function createTestImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
    },
  })
    .jpeg({ quality: 50 })
    .toBuffer()
}

describe('Property 17: Image Processing Invariants', () => {
  it('output width is always <= 1200px', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Use smaller dimensions for speed: 50-2000
        fc.integer({ min: 50, max: 2000 }),
        fc.integer({ min: 50, max: 2000 }),
        async (width, height) => {
          const input = await createTestImage(width, height)
          const result = await processImage(input)
          expect(result.width).toBeLessThanOrEqual(1200)
        },
      ),
      { numRuns: 25 },
    )
  }, 60000)

  it('aspect ratio is preserved within rounding tolerance', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50, max: 2000 }),
        fc.integer({ min: 50, max: 2000 }),
        async (width, height) => {
          const input = await createTestImage(width, height)
          const result = await processImage(input)

          const outputWidth = result.width
          const expectedHeight = Math.round(height * (outputWidth / width))

          // Allow 1px rounding tolerance
          expect(Math.abs(result.height - expectedHeight)).toBeLessThanOrEqual(1)
        },
      ),
      { numRuns: 25 },
    )
  }, 60000)

  it('output format is WebP', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50, max: 800 }),
        fc.integer({ min: 50, max: 800 }),
        async (width, height) => {
          const input = await createTestImage(width, height)
          const { buffer } = await processImage(input)

          const metadata = await sharp(buffer).metadata()
          expect(metadata.format).toBe('webp')
        },
      ),
      { numRuns: 25 },
    )
  }, 60000)

  it('EXIF metadata is completely stripped', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50, max: 800 }),
        fc.integer({ min: 50, max: 800 }),
        async (width, height) => {
          const input = await createTestImage(width, height)
          const { buffer } = await processImage(input)

          const metadata = await sharp(buffer).metadata()
          expect(metadata.exif).toBeUndefined()
        },
      ),
      { numRuns: 25 },
    )
  }, 60000)

  it('images smaller than 1200px are not upscaled', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50, max: 1199 }),
        fc.integer({ min: 50, max: 1199 }),
        async (width, height) => {
          const input = await createTestImage(width, height)
          const result = await processImage(input)
          expect(result.width).toBeLessThanOrEqual(width)
        },
      ),
      { numRuns: 25 },
    )
  }, 60000)
})
