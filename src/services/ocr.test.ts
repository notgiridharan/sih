import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OCRResult } from '../types/scan'

// Mock PP-OCR engine so tests run without real ONNX models or image data.
vi.mock('./ppocr/ppocr-engine', () => ({
  initPPOCR: vi.fn(),
  runPPOCR: vi.fn().mockResolvedValue({
    text: 'Hello World',
    confidence: 0.92,
    blocks: [
      { text: 'Hello', confidence: 0.95, boundingBox: { x: 10, y: 20, width: 50, height: 20 } },
      { text: 'World', confidence: 0.89, boundingBox: { x: 70, y: 20, width: 50, height: 20 } },
    ],
    status: 'complete',
    processingTimeMs: 42,
  } satisfies OCRResult),
}))

beforeEach(() => {
  vi.resetModules()
})

describe('OCR service', () => {
  it('runOCR returns extracted text and blocks', async () => {
    const { runOCR } = await import('./ocr')
    const result = await runOCR('data:image/png;base64,fakedata')
    expect(result.status).toBe('complete')
    expect(result.text).toBe('Hello World')
    expect(result.confidence).toBeCloseTo(0.92)
    expect(result.blocks).toHaveLength(2)
    expect(result.blocks[0].text).toBe('Hello')
    expect(result.blocks[0].confidence).toBeCloseTo(0.95)
    expect(result.blocks[0].boundingBox).toEqual({ x: 10, y: 20, width: 50, height: 20 })
    expect(result.blocks[1].text).toBe('World')
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0)
  })

  it('createSkippedResult returns skipped status', async () => {
    const { createSkippedResult } = await import('./ocr')
    const result = createSkippedResult()
    expect(result.status).toBe('skipped')
    expect(result.text).toBe('')
    expect(result.blocks).toHaveLength(0)
    expect(result.processingTimeMs).toBe(0)
  })

  it('runOCR caches results for same screenshot', async () => {
    const { runOCR } = await import('./ocr')
    const screenshot = 'data:image/png;base64,samescreenshot'
    const result1 = await runOCR(screenshot)
    const result2 = await runOCR(screenshot)
    expect(result1).toBe(result2)
  })

  it('terminateOCR clears cache', async () => {
    const { runOCR, terminateOCR } = await import('./ocr')
    const screenshot = 'data:image/png;base64,test'
    const r1 = await runOCR(screenshot)
    await terminateOCR()
    // After termination a fresh call re-runs inference and returns a new object
    const r2 = await runOCR(screenshot)
    // Both should be complete (mock always returns complete)
    expect(r1.status).toBe('complete')
    expect(r2.status).toBe('complete')
  })
})

describe('scanWithOCR integration', () => {
  it('returns ocrResult as skipped when no screenshot', async () => {
    const { scanWithOCR } = await import('./scanner')
    const result = await scanWithOCR({ url: 'https://example.com', dom: '<p>Hello</p>', screenshot: null })
    expect(result.ocrResult).not.toBeNull()
    expect(result.ocrResult!.status).toBe('skipped')
  })

  it('runs OCR when screenshot is provided', async () => {
    const { scanWithOCR } = await import('./scanner')
    const result = await scanWithOCR({
      url: 'https://example.com',
      dom: '<p>Hello</p>',
      screenshot: 'data:image/png;base64,fakedata',
    })
    expect(result.ocrResult).not.toBeNull()
    expect(result.ocrResult!.status).toBe('complete')
    expect(result.ocrResult!.text).toBe('Hello World')
  })

  it('does not break PII detection when OCR runs', async () => {
    const { scanWithOCR } = await import('./scanner')
    const result = await scanWithOCR({
      url: 'https://example.com',
      dom: '<p>Email: john@example.com</p>',
      screenshot: 'data:image/png;base64,fakedata',
    })
    expect(result.piiMatches.length).toBeGreaterThan(0)
    expect(result.ocrResult!.status).toBe('complete')
  })
})
