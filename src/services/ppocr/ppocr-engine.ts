/**
 * PP-OCRv5 end-to-end OCR engine.
 *
 * Orchestrates:
 *   1. Image decode + detection-model preprocessing
 *   2. DBNet detection → text-region bounding boxes
 *   3. Per-region recognition-model inference + CTC decode
 *   4. Result aggregation into OCRResult format
 *
 * No network calls are made during inference.  Model files must be placed in
 * the extension's `assets/models/` directory (see download-ppocr-models.js).
 *
 * Exported entry point: `runPPOCR(dataUrl, signal?): Promise<OCRResult>`
 */

import * as ort from 'onnxruntime-web'
import type { OCRResult, OCRBlock } from '../../types/scan'
import { decodeImage, prepareForDet, prepareForRec } from './ppocr-image'
import { detectTextRegions, initDetSession } from './ppocr-det'
import { recogniseText, initRecSession } from './ppocr-rec'

// ---------------------------------------------------------------------------
// ORT WASM path configuration (shared between det and rec)
// ---------------------------------------------------------------------------

let ortConfigured = false

function configureOrt(): void {
  if (ortConfigured) return
  ortConfigured = true
  const base =
    typeof chrome !== 'undefined' && chrome.runtime?.id
      ? chrome.runtime.getURL('assets/')
      : '/assets/'
  ort.env.wasm.wasmPaths = base
  ort.env.wasm.numThreads = 1
}

function modelUrl(name: string): string {
  return typeof chrome !== 'undefined' && chrome.runtime?.id
    ? chrome.runtime.getURL(`assets/models/${name}`)
    : `/assets/models/${name}`
}

// ---------------------------------------------------------------------------
// Model lifecycle
// ---------------------------------------------------------------------------

interface PPOCRSessions {
  det: ort.InferenceSession
  rec: ort.InferenceSession
}

let sessionsPromise: Promise<PPOCRSessions | null> | null = null

async function loadSessions(): Promise<PPOCRSessions | null> {
  configureOrt()
  const [det, rec] = await Promise.all([
    initDetSession(modelUrl('ppocr-v5-det.onnx')),
    initRecSession(modelUrl('ppocr-v5-rec.onnx')),
  ])
  if (!det || !rec) {
    console.warn('[Sentinel PP-OCR] One or both models unavailable — OCR disabled')
    return null
  }
  console.info('[Sentinel PP-OCR] Models loaded successfully')
  return { det, rec }
}

/** Pre-warm both models in the background. Call once at extension startup. */
export function initPPOCR(): void {
  if (!sessionsPromise) sessionsPromise = loadSessions()
}

async function getSessions(): Promise<PPOCRSessions | null> {
  if (!sessionsPromise) sessionsPromise = loadSessions()
  return sessionsPromise
}

// ---------------------------------------------------------------------------
// Main OCR entry point
// ---------------------------------------------------------------------------

const MAX_SCREENSHOT_BYTES = 5_000_000
const MAX_BOXES = 80  // cap on number of text regions per image

/**
 * Run PP-OCRv5 on a screenshot data URL.
 *
 * Mirrors the existing Tesseract-based API: never throws, returns a
 * structured OCRResult including per-word OCRBlocks with bounding boxes.
 */
export async function runPPOCR(
  dataUrl: string,
  signal?: AbortSignal,
): Promise<OCRResult> {
  const start = performance.now()

  if (dataUrl.length > MAX_SCREENSHOT_BYTES) {
    return errorResult('Screenshot too large for OCR processing', start)
  }

  const sessions = await getSessions()
  if (!sessions) {
    // Model files not present — return skipped (not error) so the scan continues
    return skippedResult()
  }

  if (signal?.aborted) return skippedResult()

  try {
    // 1. Decode image
    const imageData = await decodeImage(dataUrl)
    if (signal?.aborted) return skippedResult()

    // 2. Run detection
    const detInput = await prepareForDet(imageData)
    if (signal?.aborted) return skippedResult()

    const boxes = await detectTextRegions(sessions.det, detInput)
    if (signal?.aborted) return skippedResult()

    if (boxes.length === 0) {
      return {
        text: '',
        confidence: 0,
        blocks: [],
        status: 'complete',
        processingTimeMs: elapsed(start),
      }
    }

    // 3. Recognise each detected region (limited to MAX_BOXES for perf)
    const topBoxes = boxes.slice(0, MAX_BOXES)
    const blocks: OCRBlock[] = []
    const textParts: string[] = []
    let totalConf = 0

    for (const box of topBoxes) {
      if (signal?.aborted) return skippedResult()

      // Guard against degenerate boxes
      if (box.width < 4 || box.height < 4) continue

      const recInput = await prepareForRec(
        imageData,
        Math.max(0, box.x),
        Math.max(0, box.y),
        Math.min(box.width, imageData.width - box.x),
        Math.min(box.height, imageData.height - box.y),
      )

      const { text, confidence } = await recogniseText(sessions.rec, recInput)
      if (!text.trim()) continue

      blocks.push({
        text,
        confidence,
        boundingBox: { x: box.x, y: box.y, width: box.width, height: box.height },
      })
      textParts.push(text)
      totalConf += confidence
    }

    const avgConf = blocks.length > 0 ? totalConf / blocks.length : 0
    const fullText = textParts.join(' ')

    return {
      text: fullText,
      confidence: Math.round(avgConf * 100) / 100,
      blocks,
      status: 'complete',
      processingTimeMs: elapsed(start),
    }
  } catch (err) {
    if (signal?.aborted) return skippedResult()
    return errorResult(
      err instanceof Error ? err.message : 'PP-OCR processing failed',
      start,
    )
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function elapsed(start: number): number {
  return Math.round(performance.now() - start)
}

function errorResult(error: string, start: number): OCRResult {
  return { text: '', confidence: 0, blocks: [], status: 'error', error, processingTimeMs: elapsed(start) }
}

function skippedResult(): OCRResult {
  return { text: '', confidence: 0, blocks: [], status: 'skipped', processingTimeMs: 0 }
}
