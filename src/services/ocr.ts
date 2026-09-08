/**
 * OCR service — backed by PP-OCRv5 (local ONNX inference).
 *
 * Public API is identical to the previous Tesseract.js implementation so
 * nothing else in the codebase needs to change.
 *
 * PP-OCRv5 is a two-stage pipeline:
 *   Detection  — DBNet finds text bounding boxes in the screenshot
 *   Recognition — CRNN reads the text inside each box
 *
 * Both models run via ONNX Runtime Web (WASM provider) with no network calls.
 * When the model files are absent the service returns a `skipped` result so
 * the wider scan never fails because of missing OCR assets.
 */

import type { OCRResult } from '../types/scan'
import { runPPOCR, initPPOCR } from './ppocr/ppocr-engine'

// ---------------------------------------------------------------------------
// Result caching — avoids re-running inference on the same screenshot
// ---------------------------------------------------------------------------

let lastHash: string | null = null
let cachedResult: OCRResult | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null

const IDLE_TIMEOUT_MS = 60_000
const MAX_SCREENSHOT_BYTES = 5_000_000

function hashScreenshot(dataUrl: string): string {
  let hash = 0
  const sample = dataUrl.slice(0, 2000) + dataUrl.slice(-2000)
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) - hash + sample.charCodeAt(i)) | 0
  }
  return `${hash}_${dataUrl.length}`
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { terminateOCR() }, IDLE_TIMEOUT_MS)
}

// ---------------------------------------------------------------------------
// Abort-controller management (only one active inference at a time)
// ---------------------------------------------------------------------------

let activeController: AbortController | null = null

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Warm-up the PP-OCR models in the background.  Safe to call multiple times. */
export function warmupOCR(): void {
  initPPOCR()
}

export async function runOCR(
  screenshotDataUrl: string,
  signal?: AbortSignal,
): Promise<OCRResult> {
  if (signal?.aborted) return createAbortedResult()

  if (screenshotDataUrl.length > MAX_SCREENSHOT_BYTES) {
    return {
      text: '',
      confidence: 0,
      blocks: [],
      status: 'error',
      error: 'Screenshot too large for OCR processing',
      processingTimeMs: 0,
    }
  }

  const hash = hashScreenshot(screenshotDataUrl)
  if (hash === lastHash && cachedResult) return cachedResult

  // Cancel any in-flight inference
  if (activeController) {
    activeController.abort()
    activeController = null
  }

  const controller = new AbortController()
  activeController = controller

  // Propagate external abort into our local controller
  if (signal) {
    if (signal.aborted) { controller.abort(); return createAbortedResult() }
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    const result = await runPPOCR(screenshotDataUrl, controller.signal)

    if (controller.signal.aborted) return createAbortedResult()

    if (result.status === 'complete') {
      lastHash = hash
      cachedResult = result
      resetIdleTimer()
    }

    return result
  } finally {
    if (activeController === controller) activeController = null
  }
}

export async function terminateOCR(): Promise<void> {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  if (activeController) { activeController.abort(); activeController = null }
  lastHash = null
  cachedResult = null
}

export function createSkippedResult(): OCRResult {
  return { text: '', confidence: 0, blocks: [], status: 'skipped', processingTimeMs: 0 }
}

function createAbortedResult(): OCRResult {
  return { text: '', confidence: 0, blocks: [], status: 'skipped', processingTimeMs: 0 }
}
