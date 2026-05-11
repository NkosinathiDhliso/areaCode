import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sharp from 'sharp'

const s3 = new S3Client({})
const BUCKET = process.env['MEDIA_BUCKET'] ?? 'area-code-media'
const MAX_WIDTH = 1200

export interface ImageProcessingResult {
  processedKey: string
  width: number
  height: number
  format: string
}

/**
 * Strips all EXIF metadata, resizes to max 1200px width (maintaining aspect ratio),
 * and compresses to WebP format.
 */
export async function processImage(inputBuffer: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  const image = sharp(inputBuffer)
  const metadata = await image.metadata()

  const currentWidth = metadata.width ?? MAX_WIDTH
  const currentHeight = metadata.height ?? MAX_WIDTH
  const outputWidth = Math.min(currentWidth, MAX_WIDTH)
  const outputHeight = Math.round(currentHeight * (outputWidth / currentWidth))

  const processed = await image
    .rotate() // Auto-rotate based on EXIF orientation before stripping
    .resize(outputWidth, outputHeight, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()

  return { buffer: processed, width: outputWidth, height: outputHeight }
}

/**
 * Processes an uploaded image from S3: strips EXIF, resizes, converts to WebP.
 * Stores the processed version and returns the new key.
 */
export async function processUploadedImage(objectKey: string): Promise<ImageProcessingResult> {
  // Fetch original from S3
  const getResult = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: objectKey }))
  const bodyBytes = await getResult.Body?.transformToByteArray()
  if (!bodyBytes) throw new Error('Empty S3 object')

  const inputBuffer = Buffer.from(bodyBytes)
  const { buffer, width, height } = await processImage(inputBuffer)

  // Store processed version with .webp extension
  const processedKey = objectKey.replace(/\.[^.]+$/, '.webp')
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: processedKey,
      Body: buffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000',
    }),
  )

  // Delete original if different key
  if (processedKey !== objectKey) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: objectKey }))
  }

  return { processedKey, width, height, format: 'webp' }
}

/**
 * Generates a presigned S3 PUT URL for direct upload.
 * Scoped to the nodeId for security.
 */
export async function generateUploadUrl(
  nodeId: string,
  contentType: string,
): Promise<{ uploadUrl: string; objectKey: string }> {
  const allowedTypes = ['image/jpeg', 'image/png']
  if (!allowedTypes.includes(contentType)) {
    throw new Error('Only JPEG and PNG images are allowed')
  }

  const ext = contentType === 'image/png' ? 'png' : 'jpg'
  const objectKey = `nodes/${nodeId}/header-${Date.now()}.${ext}`

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: objectKey,
    ContentType: contentType,
    ContentLength: 2 * 1024 * 1024, // Max 2MB
  })

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 })

  return { uploadUrl, objectKey }
}

/**
 * Deletes an image from S3.
 */
export async function deleteImage(objectKey: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: objectKey }))
}
