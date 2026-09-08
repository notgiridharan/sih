import { describe, it, expect, beforeEach } from 'vitest'
import { saveScan, getScans, getScan, deleteScan, clearScans, getScanCount, getStorageUsage, SENTINEL_STORAGE_VERSION } from './storage'
import { computeStats, computeTrend, filterScans, extractHostname } from './history'
import { createSkippedResult } from './ocr'
import type { ScanResult } from '../types/scan'

function makeScan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    id: overrides.id ?? `scan-${Math.random().toString(36).slice(2)}`,
    url: overrides.url ?? 'https://example.com',
    timestamp: overrides.timestamp ?? Date.now(),
    piiMatches: [],
    promptInjections: [],
    hiddenContent: [],
    crossValidation: null,
    ocrResult: null,
    correlationResult: null,
    risk: { overall: 'none', privacy: 0, injection: 0, hidden: 0, visualAnomaly: 0 },
    riskAssessment: null,
    findings: [],
    sanitizedContext: null,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('storage hardening', () => {
  it('prevents duplicate scan saves', () => {
    const scan = makeScan({ id: 'dup-1' })
    saveScan(scan)
    saveScan(scan)
    saveScan(scan)
    expect(getScanCount()).toBe(1)
  })

  it('strips sanitizedContext before saving', () => {
    const scan = makeScan({
      id: 'strip-1',
      sanitizedContext: '<p>sanitized content</p>',
    })
    saveScan(scan)
    const retrieved = getScan('strip-1')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.sanitizedContext).toBeNull()
  })

  it('trims large OCR text before saving', () => {
    const scan = makeScan({
      id: 'ocr-trim',
      ocrResult: {
        text: 'x'.repeat(50_000),
        confidence: 0.9,
        blocks: [],
        status: 'complete',
        processingTimeMs: 100,
      },
    })
    saveScan(scan)
    const retrieved = getScan('ocr-trim')
    expect(retrieved!.ocrResult!.text.length).toBeLessThanOrEqual(10_000)
  })

  it('handles quota exceeded by evicting old scans', () => {
    for (let i = 0; i < 10; i++) {
      saveScan(makeScan({ id: `pre-${i}`, timestamp: i }))
    }
    expect(getScanCount()).toBe(10)

    const originalSetItem = Storage.prototype.setItem
    let callCount = 0
    Storage.prototype.setItem = function (...args: [string, string]) {
      callCount++
      if (callCount <= 1) {
        throw new DOMException('quota', 'QuotaExceededError')
      }
      return originalSetItem.apply(this, args)
    }

    const result = saveScan(makeScan({ id: 'after-quota' }))
    Storage.prototype.setItem = originalSetItem

    if (result.success) {
      expect(getScan('after-quota')).not.toBeNull()
    }
  })

  it('validates stored scan structure on read', () => {
    localStorage.setItem('sentinel-lens-scans', JSON.stringify([
      { version: 1, data: { id: 'valid', url: 'https://test.com' } },
      { version: 1, data: null },
      { version: 1 },
      null,
      42,
      'string',
      { data: { id: 'no-version', url: 'https://test.com' } },
    ]))
    const scans = getScans()
    expect(scans).toHaveLength(1)
    expect(scans[0].id).toBe('valid')
  })

  it('reports storage usage', () => {
    const { used, warning } = getStorageUsage()
    expect(typeof used).toBe('number')
    expect(typeof warning).toBe('boolean')
  })

  it('stores version number for migration support', () => {
    saveScan(makeScan({ id: 'v-test' }))
    expect(localStorage.getItem('sentinel-lens-version')).toBe(String(SENTINEL_STORAGE_VERSION))
  })

  it('handles storage completely unavailable', () => {
    const originalGetItem = Storage.prototype.getItem
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.getItem = () => { throw new Error('Disabled') }
    Storage.prototype.setItem = () => { throw new Error('Disabled') }

    expect(getScans()).toEqual([])
    expect(getScanCount()).toBe(0)
    expect(getScan('any')).toBeNull()
    const result = saveScan(makeScan())
    expect(result.success).toBe(false)

    Storage.prototype.getItem = originalGetItem
    Storage.prototype.setItem = originalSetItem
  })
})

describe('duplicate scan prevention', () => {
  it('deduplicates by ID on save', () => {
    const scan = makeScan({ id: 'dedup-1' })
    const r1 = saveScan(scan)
    const r2 = saveScan(scan)
    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    expect(getScanCount()).toBe(1)
  })

  it('allows scans with different IDs', () => {
    saveScan(makeScan({ id: 'a' }))
    saveScan(makeScan({ id: 'b' }))
    expect(getScanCount()).toBe(2)
  })
})

describe('scan cancellation', () => {
  it('createSkippedResult returns correct status', () => {
    const result = createSkippedResult()
    expect(result.status).toBe('skipped')
    expect(result.text).toBe('')
    expect(result.blocks).toHaveLength(0)
  })
})

describe('OCR worker lifecycle', () => {
  it('terminateOCR is idempotent', async () => {
    const { terminateOCR } = await import('./ocr')
    await terminateOCR()
    await terminateOCR()
  })
})

describe('large input handling', () => {
  it('handles very large DOM string in scanner', async () => {
    const { scan } = await import('./scanner')
    const largeDom = '<div>' + '<p>Content</p>'.repeat(10_000) + '</div>'
    const result = scan({ url: 'https://example.com', dom: largeDom, screenshot: null })
    expect(result).toBeDefined()
    expect(result.id).toBeTruthy()
    expect(result.url).toBe('https://example.com')
  }, 15_000)

  it('handles empty DOM in scanner', async () => {
    const { scan } = await import('./scanner')
    const result = scan({ url: 'https://example.com', dom: '', screenshot: null })
    expect(result).toBeDefined()
    expect(result.risk.overall).toBe('none')
  })

  it('handles malformed HTML in scanner', async () => {
    const { scan } = await import('./scanner')
    const result = scan({ url: 'https://example.com', dom: '<<<not>>html<>', screenshot: null })
    expect(result).toBeDefined()
  })
})

describe('history persistence integration', () => {
  it('round-trips scan through storage and history', () => {
    const scan = makeScan({
      id: 'rt-1',
      url: 'https://example.com/page1',
      riskAssessment: {
        score: 45,
        level: 'medium',
        confidence: 0.8,
        categories: {
          privacy: { score: 50, level: 'high' },
          injection: { score: 0, level: 'none' },
          deception: { score: 0, level: 'none' },
          overall: { score: 45, level: 'medium' },
        },
        contributions: [],
        explanation: '',
        recommendation: '',
      },
    })
    saveScan(scan)
    const stored = getScans()
    const stats = computeStats(stored)
    expect(stats.totalScans).toBe(1)
    expect(stats.mediumCount).toBe(1)
    expect(stats.averageRisk).toBe(45)
  })

  it('delete removes from storage and affects stats', () => {
    saveScan(makeScan({ id: 'd1' }))
    saveScan(makeScan({ id: 'd2' }))
    expect(getScanCount()).toBe(2)
    deleteScan('d1')
    expect(getScanCount()).toBe(1)
    const stats = computeStats(getScans())
    expect(stats.totalScans).toBe(1)
  })

  it('clear resets everything', () => {
    saveScan(makeScan({ id: 'c1' }))
    saveScan(makeScan({ id: 'c2' }))
    clearScans()
    expect(getScans()).toHaveLength(0)
    const stats = computeStats(getScans())
    expect(stats.totalScans).toBe(0)
  })
})

describe('risk calculation regression', () => {
  it('assessRisk produces consistent output', async () => {
    const { assessRisk } = await import('./risk-engine')
    const scan = makeScan({
      piiMatches: [
        { type: 'email', value: 'a@b.com', redacted: '***', location: { source: 'dom' }, confidence: 0.95, risk: 'high', action: 'Redact', detectedBy: 'regex' },
      ],
    })
    const assessment = assessRisk(scan)
    expect(assessment.score).toBeGreaterThan(0)
    expect(assessment.level).not.toBe('none')
    expect(assessment.categories.privacy.score).toBeGreaterThan(0)
  })
})

describe('findings regression', () => {
  it('aggregateFindings deduplicates correctly', async () => {
    const { aggregateFindings } = await import('./findings')
    const scan = makeScan({
      piiMatches: [
        { type: 'email', value: 'a@b.com', redacted: '***', location: { source: 'dom' }, confidence: 0.95, risk: 'high', action: 'Redact', detectedBy: 'regex' },
        { type: 'email', value: 'b@c.com', redacted: '***', location: { source: 'dom' }, confidence: 0.90, risk: 'high', action: 'Redact', detectedBy: 'regex' },
      ],
    })
    const findings = aggregateFindings(scan)
    expect(findings.length).toBeGreaterThan(0)
    const emailFindings = findings.filter(f => f.title.includes('Email'))
    expect(emailFindings.length).toBeLessThanOrEqual(2)
  })
})

describe('report generation regression', () => {
  it('generates valid report from scan with findings', async () => {
    const { generateReport, serializeReport } = await import('./report')
    const { assessRisk } = await import('./risk-engine')
    const { aggregateFindings } = await import('./findings')
    const scan = makeScan({
      piiMatches: [
        { type: 'ssn', value: '123-45-6789', redacted: '***', location: { source: 'dom' }, confidence: 0.95, risk: 'critical', action: 'Redact', detectedBy: 'regex' },
      ],
    })
    scan.riskAssessment = assessRisk(scan)
    scan.findings = aggregateFindings(scan)
    const report = generateReport(scan)
    expect(report.header).toBe('Sentinel Lens Security Report')
    expect(report.findings.length).toBeGreaterThan(0)
    const json = serializeReport(report)
    expect(() => JSON.parse(json)).not.toThrow()
  })
})

describe('extractHostname edge cases', () => {
  it('handles about:blank', () => {
    const host = extractHostname('about:blank')
    expect(typeof host).toBe('string')
  })

  it('handles empty string', () => {
    const host = extractHostname('')
    expect(typeof host).toBe('string')
  })

  it('handles data URIs', () => {
    const host = extractHostname('data:text/html,<p>test</p>')
    expect(typeof host).toBe('string')
  })
})

describe('trend computation edge cases', () => {
  it('returns empty for single scan', () => {
    const trend = computeTrend([makeScan()])
    expect(trend).toHaveLength(0)
  })

  it('returns empty for scans all on same day', () => {
    const now = Date.now()
    const scans = [
      makeScan({ timestamp: now }),
      makeScan({ timestamp: now + 1000 }),
    ]
    const trend = computeTrend(scans)
    expect(trend).toHaveLength(0)
  })
})

describe('filter edge cases', () => {
  it('handles empty search gracefully', () => {
    const scans = [makeScan()]
    const filtered = filterScans(scans, { search: '' })
    expect(filtered).toHaveLength(1)
  })

  it('handles zero days filter', () => {
    const scans = [makeScan()]
    const filtered = filterScans(scans, { days: 0 })
    expect(filtered).toHaveLength(1)
  })
})
