/**
 * Image preprocessing utilities for PP-OCRv5.
 *
 * All operations run entirely in-browser using OffscreenCanvas.
 * No image data leaves the device.
 */

export interface PreparedTensor {
  data: Float32Array
  height: number
  width: number
}

// ImageNet normalization constants used by PP-OCR models
const DET_MEAN = [0.485, 0.456, 0.406]
const DET_STD  = [0.229, 0.224, 0.225]
const REC_MEAN = [0.5, 0.5, 0.5]
const REC_STD  = [0.5, 0.5, 0.5]

/** Decode a data: URL or blob URL to raw RGBA ImageData. */
export async function decodeImage(dataUrl: string): Promise<ImageData> {
  const resp = await fetch(dataUrl)
  const blob = await resp.blob()
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.drawImage(bitmap, 0, 0)
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  bitmap.close()
  return imageData
}

/**
 * Crop a rectangular region from ImageData and resize it to target dimensions.
 *
 * @param src      Source ImageData (full image)
 * @param sx       Crop origin X in the source image
 * @param sy       Crop origin Y in the source image
 * @param sw       Crop width in the source image
 * @param sh       Crop height in the source image
 * @param targetW  Output width
 * @param targetH  Output height
 */
export async function cropAndResize(
  src: ImageData,
  sx: number, sy: number, sw: number, sh: number,
  targetW: number, targetH: number,
): Promise<ImageData> {
  const bitmap = await createImageBitmap(src, sx, sy, sw, sh, {
    resizeWidth: targetW,
    resizeHeight: targetH,
    resizeQuality: 'medium',
  })
  const canvas = new OffscreenCanvas(targetW, targetH)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.drawImage(bitmap, 0, 0)
  const out = ctx.getImageData(0, 0, targetW, targetH)
  bitmap.close()
  return out
}

/**
 * Convert RGBA ImageData to a normalized CHW Float32 tensor [1, 3, H, W].
 *
 * @param imageData  RGBA source
 * @param mean       Per-channel mean for normalization (RGB order)
 * @param std        Per-channel std for normalization (RGB order)
 */
export function rgbaToChwTensor(
  imageData: ImageData,
  mean: number[],
  std: number[],
): Float32Array {
  const { width: W, height: H, data } = imageData
  const tensor = new Float32Array(3 * H * W)
  const planeR = 0
  const planeG = H * W
  const planeB = H * W * 2

  for (let i = 0; i < H * W; i++) {
    const r = data[i * 4] / 255
    const g = data[i * 4 + 1] / 255
    const b = data[i * 4 + 2] / 255
    tensor[planeR + i] = (r - mean[0]) / std[0]
    tensor[planeG + i] = (g - mean[1]) / std[1]
    tensor[planeB + i] = (b - mean[2]) / std[2]
  }
  return tensor
}

/**
 * Prepare image for the PP-OCR detection model.
 *
 * Resizes the image so both sides are multiples of 32 and at most `maxSide`
 * pixels.  Returns the tensor [1, 3, H', W'] and the actual scaled dimensions
 * so detection boxes can be mapped back to the original image.
 */
export async function prepareForDet(
  imageData: ImageData,
  maxSide = 960,
): Promise<PreparedTensor & { origW: number; origH: number }> {
  const { width: origW, height: origH } = imageData

  // Scale so the longest side ≤ maxSide while keeping aspect ratio
  let scale = 1
  if (Math.max(origW, origH) > maxSide) {
    scale = maxSide / Math.max(origW, origH)
  }

  // Snap to nearest multiple of 32 (PP-OCR det requirement)
  const scaledW = Math.max(32, Math.round((origW * scale) / 32) * 32)
  const scaledH = Math.max(32, Math.round((origH * scale) / 32) * 32)

  const resized = await cropAndResize(imageData, 0, 0, origW, origH, scaledW, scaledH)
  const data = rgbaToChwTensor(resized, DET_MEAN, DET_STD)

  return { data, height: scaledH, width: scaledW, origW, origH }
}

/**
 * Prepare a single text-region crop for the PP-OCR recognition model.
 *
 * The rec model expects [1, 3, 48, W] where W is proportional to the crop's
 * aspect ratio (capped at 320).
 */
export async function prepareForRec(
  imageData: ImageData,
  sx: number, sy: number, sw: number, sh: number,
): Promise<PreparedTensor> {
  const REC_HEIGHT = 48
  const MAX_WIDTH = 320

  const aspect = sw / Math.max(sh, 1)
  const targetW = Math.min(Math.max(Math.round(REC_HEIGHT * aspect), 8), MAX_WIDTH)
  const targetH = REC_HEIGHT

  const resized = await cropAndResize(imageData, sx, sy, sw, sh, targetW, targetH)
  const data = rgbaToChwTensor(resized, REC_MEAN, REC_STD)

  return { data, height: targetH, width: targetW }
}

export { DET_MEAN, DET_STD, REC_MEAN, REC_STD }
