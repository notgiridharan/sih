import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn().mockResolvedValue({
    recognize: vi.fn().mockResolvedValue({
      data: {
        text: 'Hello World',
        confidence: 92,
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    words: [
                      { text: 'Hello', confidence: 95, bbox: { x0: 10, y0: 20, x1: 60, y1: 40 } },
                      { text: 'World', confidence: 89, bbox: { x0: 70, y0: 20, x1: 120, y1: 40 } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
    terminate: vi.fn().mockResolvedValue(undefined),
  }),
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

  it('terminateOCR cleans up worker', async () => {
    const { runOCR, terminateOCR } = await import('./ocr')
    await runOCR('data:image/png;base64,test')
    await terminateOCR()
    const result = await runOCR('data:image/png;base64,test')
    expect(result.status).toBe('complete')
  })
})

describe('scanWithOCR integration', () => {
  it('returns ocrResult as skipped when no screenshot', async () => {
    const { scanWithOCR } = await import('./scanner')
    const result = await scanWithOCR({ url: 'https://example.com', dom: '<p>Hello</p>' })
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
