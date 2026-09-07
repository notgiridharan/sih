import type { OCRResult, OCRBlock } from '../types/scan'

let workerInstance: import('tesseract.js').Worker | null = null
let workerPromise: Promise<import('tesseract.js').Worker> | null = null
let lastScreenshotHash: string | null = null
let cachedResult: OCRResult | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let activeRecognition: AbortController | null = null

const IDLE_TIMEOUT_MS = 60_000
const MAX_SCREENSHOT_BYTES = 5_000_000

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { terminateOCR() }, IDLE_TIMEOUT_MS)
}

async function getWorker(): Promise<import('tesseract.js').Worker> {
  if (workerInstance) return workerInstance
  if (workerPromise) return workerPromise

  workerPromise = (async () => {
    const Tesseract = await import('tesseract.js')
    const worker = await Tesseract.createWorker('eng', undefined, {
      logger: () => {},
    })
    workerInstance = worker
    return worker
  })()

  return workerPromise
}

function hashScreenshot(dataUrl: string): string {
  let hash = 0
  const sample = dataUrl.slice(0, 2000) + dataUrl.slice(-2000)
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) - hash + sample.charCodeAt(i)) | 0
  }
  return `${hash}_${dataUrl.length}`
}

export async function runOCR(
  screenshotDataUrl: string,
  signal?: AbortSignal,
): Promise<OCRResult> {
  if (signal?.aborted) {
    return createAbortedResult()
  }

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
  if (hash === lastScreenshotHash && cachedResult) {
    return cachedResult
  }

  if (activeRecognition) {
    activeRecognition.abort()
    activeRecognition = null
  }

  const controller = new AbortController()
  activeRecognition = controller

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  const start = performance.now()

  try {
    const worker = await getWorker()

    if (controller.signal.aborted) {
      return createAbortedResult()
    }

    const { data } = await worker.recognize(screenshotDataUrl)

    if (controller.signal.aborted) {
      return createAbortedResult()
    }

    const blocks: OCRBlock[] = []
    if (data.blocks) {
      for (const block of data.blocks) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            for (const word of line.words) {
              if (!word.text.trim()) continue
              blocks.push({
                text: word.text,
                confidence: word.confidence / 100,
                boundingBox: {
                  x: word.bbox.x0,
                  y: word.bbox.y0,
                  width: word.bbox.x1 - word.bbox.x0,
                  height: word.bbox.y1 - word.bbox.y0,
                },
              })
            }
          }
        }
      }
    }

    const result: OCRResult = {
      text: data.text || '',
      confidence: (data.confidence ?? 0) / 100,
      blocks,
      status: 'complete',
      processingTimeMs: Math.round(performance.now() - start),
    }

    lastScreenshotHash = hash
    cachedResult = result
    resetIdleTimer()
    return result
  } catch (err) {
    if (controller.signal.aborted) {
      return createAbortedResult()
    }
    return {
      text: '',
      confidence: 0,
      blocks: [],
      status: 'error',
      error: err instanceof Error ? err.message : 'OCR processing failed',
      processingTimeMs: Math.round(performance.now() - start),
    }
  } finally {
    if (activeRecognition === controller) {
      activeRecognition = null
    }
  }
}

export async function terminateOCR(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (activeRecognition) {
    activeRecognition.abort()
    activeRecognition = null
  }
  if (workerInstance) {
    await workerInstance.terminate()
    workerInstance = null
  }
  workerPromise = null
  lastScreenshotHash = null
  cachedResult = null
}

export function createSkippedResult(): OCRResult {
  return {
    text: '',
    confidence: 0,
    blocks: [],
    status: 'skipped',
    processingTimeMs: 0,
  }
}

function createAbortedResult(): OCRResult {
  return {
    text: '',
    confidence: 0,
    blocks: [],
    status: 'skipped',
    processingTimeMs: 0,
  }
}
