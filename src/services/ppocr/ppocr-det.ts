/**
 * PP-OCRv5 text detection.
 *
 * Runs the DBNet-based detection model (ONNX) to find text regions in the
 * image.  Returns a list of axis-aligned bounding boxes in original-image
 * coordinates.
 *
 * Model file: assets/models/ppocr-v5-det.onnx
 * Input:  "x"               [1, 3, H, W]  Float32
 * Output: "sigmoid_0.tmp_0" [1, 1, H, W]  Float32  (probability map)
 */

import * as ort from 'onnxruntime-web'
import type { PreparedTensor } from './ppocr-image'

export interface DetBox {
  /** Coordinates in the *original* image (before scaling). */
  x: number
  y: number
  width: number
  height: number
  score: number
}

// Minimum pixel area in the *scaled* prob-map to count as a text region
const MIN_AREA = 16

// DBNet threshold: pixels above this are considered text
const THRESHOLD = 0.3

// Expansion ratio applied to each detected box (improves recall at edges)
const EXPAND_RATIO = 1.5

// ---------------------------------------------------------------------------
// Utility: simple BFS connected-component labelling on the probability map
// ---------------------------------------------------------------------------

function findBoxes(
  probMap: Float32Array,
  mapW: number,
  mapH: number,
  scaleX: number,
  scaleY: number,
): DetBox[] {
  const visited = new Uint8Array(mapW * mapH)
  const boxes: DetBox[] = []

  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const idx = y * mapW + x
      if (probMap[idx] < THRESHOLD || visited[idx]) continue

      // BFS over connected text-pixels
      const queue: number[] = [idx]
      visited[idx] = 1
      let minX = x, maxX = x, minY = y, maxY = y
      let sumScore = 0
      let count = 0

      let head = 0
      while (head < queue.length) {
        const cur = queue[head++]
        const cy = (cur / mapW) | 0
        const cx = cur % mapW
        const score = probMap[cur]
        sumScore += score
        count++

        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy

        // 4-connected neighbours
        const neighbours = [cur - mapW, cur + mapW, cur - 1, cur + 1]
        for (const nb of neighbours) {
          if (nb < 0 || nb >= mapW * mapH) continue
          const nbX = nb % mapW
          // guard against row-wrap for left/right neighbours
          if (Math.abs(nbX - cx) > 1) continue
          if (!visited[nb] && probMap[nb] >= THRESHOLD) {
            visited[nb] = 1
            queue.push(nb)
          }
        }
      }

      if (count < MIN_AREA) continue

      const avgScore = sumScore / count

      // Expand box slightly and clamp to map bounds
      const padX = Math.round((maxX - minX) * ((EXPAND_RATIO - 1) / 2))
      const padY = Math.round((maxY - minY) * ((EXPAND_RATIO - 1) / 2))
      const bx1 = Math.max(0, minX - padX)
      const by1 = Math.max(0, minY - padY)
      const bx2 = Math.min(mapW - 1, maxX + padX)
      const by2 = Math.min(mapH - 1, maxY + padY)

      // Scale back to original-image coordinates
      boxes.push({
        x: Math.round(bx1 * scaleX),
        y: Math.round(by1 * scaleY),
        width: Math.round((bx2 - bx1) * scaleX),
        height: Math.round((by2 - by1) * scaleY),
        score: avgScore,
      })
    }
  }

  return boxes
}

// ---------------------------------------------------------------------------
// Non-maximum suppression (simple area-based, good enough for text boxes)
// ---------------------------------------------------------------------------

function iou(a: DetBox, b: DetBox): number {
  const ax2 = a.x + a.width
  const ay2 = a.y + a.height
  const bx2 = b.x + b.width
  const by2 = b.y + b.height

  const ix1 = Math.max(a.x, b.x)
  const iy1 = Math.max(a.y, b.y)
  const ix2 = Math.min(ax2, bx2)
  const iy2 = Math.min(ay2, by2)

  if (ix2 <= ix1 || iy2 <= iy1) return 0

  const inter = (ix2 - ix1) * (iy2 - iy1)
  const aArea = a.width * a.height
  const bArea = b.width * b.height
  return inter / (aArea + bArea - inter)
}

function nms(boxes: DetBox[], iouThreshold = 0.5): DetBox[] {
  boxes.sort((a, b) => b.score - a.score)
  const kept: DetBox[] = []
  const suppressed = new Uint8Array(boxes.length)

  for (let i = 0; i < boxes.length; i++) {
    if (suppressed[i]) continue
    kept.push(boxes[i])
    for (let j = i + 1; j < boxes.length; j++) {
      if (!suppressed[j] && iou(boxes[i], boxes[j]) > iouThreshold) {
        suppressed[j] = 1
      }
    }
  }

  return kept
}

// ---------------------------------------------------------------------------
// Session singleton
// ---------------------------------------------------------------------------

let detSession: ort.InferenceSession | null = null
let detSessionPromise: Promise<ort.InferenceSession | null> | null = null

async function loadDetSession(modelUrl: string): Promise<ort.InferenceSession | null> {
  try {
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'basic',
      enableCpuMemArena: false,
    })
    detSession = session
    return session
  } catch (err) {
    console.warn('[Sentinel PP-OCR det] Model load failed:', (err as Error).message)
    return null
  }
}

export function initDetSession(modelUrl: string): Promise<ort.InferenceSession | null> {
  if (!detSessionPromise) detSessionPromise = loadDetSession(modelUrl)
  return detSessionPromise
}

export async function getDetSession(): Promise<ort.InferenceSession | null> {
  return detSession ?? detSessionPromise ?? null
}

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

/**
 * Detect text regions in the image.
 *
 * @param session   Loaded ONNX det session
 * @param prepared  Output from `prepareForDet()`
 * @returns         Array of DetBox in original-image coordinates
 */
export async function detectTextRegions(
  session: ort.InferenceSession,
  prepared: PreparedTensor & { origW: number; origH: number },
): Promise<DetBox[]> {
  const { data, height: mapH, width: mapW, origW, origH } = prepared

  const inputTensor = new ort.Tensor('float32', data, [1, 3, mapH, mapW])
  const results = await session.run({ x: inputTensor })

  // Try common output node names used by PP-OCR det ONNX exports
  const probTensor =
    results['sigmoid_0.tmp_0'] ??
    results['out'] ??
    results[Object.keys(results)[0]]

  if (!probTensor) return []

  const probData = probTensor.data as Float32Array

  const scaleX = origW / mapW
  const scaleY = origH / mapH

  const rawBoxes = findBoxes(probData, mapW, mapH, scaleX, scaleY)
  return nms(rawBoxes)
}
