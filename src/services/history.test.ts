import { describe, it, expect } from 'vitest'
import { computeStats, computeDomainStats, computeTrend, filterScans, highestRiskDomains, extractHostname } from './history'
import type { ScanResult } from '../types/scan'

function makeScan(overrides: Partial<ScanResult> & { url?: string; riskScore?: number; riskLevel?: string } = {}): ScanResult {
  const score = overrides.riskScore ?? 0
  const level = (overrides.riskLevel ?? 'none') as ScanResult['risk']['overall']
  return {
    id: `s-${Math.random().toString(36).slice(2)}`,
    url: overrides.url ?? 'https://example.com',
    timestamp: overrides.timestamp ?? Date.now(),
    piiMatches: overrides.piiMatches ?? [],
    promptInjections: overrides.promptInjections ?? [],
    hiddenContent: overrides.hiddenContent ?? [],
    crossValidation: overrides.crossValidation ?? null,
    ocrResult: overrides.ocrResult ?? null,
    correlationResult: overrides.correlationResult ?? null,
    risk: overrides.risk ?? { overall: level, privacy: 0, injection: 0, hidden: 0, visualAnomaly: 0 },
    riskAssessment: overrides.riskAssessment ?? {
      score,
      level,
      confidence: 0.8,
      categories: {
        privacy: { score: 0, level: 'none' },
        injection: { score: 0, level: 'none' },
        deception: { score: 0, level: 'none' },
        overall: { score, level },
      },
      contributions: [],
      explanation: '',
      recommendation: '',
    },
    findings: overrides.findings ?? [],
    sanitizedContext: null,
  }
}

describe('history statistics', () => {
  it('computes total scans', () => {
    const stats = computeStats([makeScan(), makeScan(), makeScan()])
    expect(stats.totalScans).toBe(3)
  })

  it('counts risk levels correctly', () => {
    const scans = [
      makeScan({ riskScore: 90, riskLevel: 'critical' }),
      makeScan({ riskScore: 70, riskLevel: 'high' }),
      makeScan({ riskScore: 40, riskLevel: 'medium' }),
      makeScan({ riskScore: 10, riskLevel: 'low' }),
      makeScan({ riskScore: 0, riskLevel: 'none' }),
    ]
    const stats = computeStats(scans)
    expect(stats.criticalCount).toBe(1)
    expect(stats.highCount).toBe(1)
    expect(stats.mediumCount).toBe(1)
    expect(stats.lowCount).toBe(1)
    expect(stats.noneCount).toBe(1)
  })

  it('computes average risk', () => {
    const scans = [
      makeScan({ riskScore: 80, riskLevel: 'critical' }),
      makeScan({ riskScore: 20, riskLevel: 'low' }),
    ]
    const stats = computeStats(scans)
    expect(stats.averageRisk).toBe(50)
  })

  it('counts scans today', () => {
    const now = Date.now()
    const yesterday = now - 86_400_000 - 1000
    const scans = [
      makeScan({ timestamp: now }),
      makeScan({ timestamp: now - 3600_000 }),
      makeScan({ timestamp: yesterday }),
    ]
    const stats = computeStats(scans)
    expect(stats.scansToday).toBe(2)
  })

  it('computes domain counts', () => {
    const scans = [
      makeScan({ url: 'https://example.com/page1' }),
      makeScan({ url: 'https://example.com/page2' }),
      makeScan({ url: 'https://google.com' }),
    ]
    const domains = computeDomainStats(scans)
    expect(domains).toHaveLength(2)
    expect(domains[0].hostname).toBe('example.com')
    expect(domains[0].scanCount).toBe(2)
    expect(domains[1].hostname).toBe('google.com')
    expect(domains[1].scanCount).toBe(1)
  })

  it('finds highest-risk domain', () => {
    const scans = [
      makeScan({ url: 'https://safe.com', riskScore: 10, riskLevel: 'low' }),
      makeScan({ url: 'https://risky.com', riskScore: 90, riskLevel: 'critical' }),
    ]
    const top = highestRiskDomains(scans, 5)
    expect(top[0].hostname).toBe('risky.com')
    expect(top[0].highestScore).toBe(90)
  })

  it('returns empty stats for empty history', () => {
    const stats = computeStats([])
    expect(stats.totalScans).toBe(0)
    expect(stats.averageRisk).toBe(0)
    expect(stats.scansToday).toBe(0)
    expect(stats.highRiskDomains).toBe(0)
  })

  it('computes trend from multi-day data', () => {
    const day1 = new Date('2026-09-05T10:00:00Z').getTime()
    const day2 = new Date('2026-09-06T10:00:00Z').getTime()
    const scans = [
      makeScan({ timestamp: day1, riskScore: 40, riskLevel: 'medium' }),
      makeScan({ timestamp: day1 + 3600_000, riskScore: 60, riskLevel: 'high' }),
      makeScan({ timestamp: day2, riskScore: 80, riskLevel: 'critical' }),
    ]
    const trend = computeTrend(scans)
    expect(trend.length).toBeGreaterThanOrEqual(2)
    expect(trend[0].avgScore).toBe(50)
    expect(trend[1].avgScore).toBe(80)
  })
})

describe('filter scans', () => {
  it('filters by risk level', () => {
    const scans = [
      makeScan({ riskScore: 90, riskLevel: 'critical' }),
      makeScan({ riskScore: 10, riskLevel: 'low' }),
    ]
    const filtered = filterScans(scans, { riskLevel: 'critical' })
    expect(filtered).toHaveLength(1)
  })

  it('filters by search term', () => {
    const scans = [
      makeScan({ url: 'https://example.com/login' }),
      makeScan({ url: 'https://google.com/search' }),
    ]
    const filtered = filterScans(scans, { search: 'google' })
    expect(filtered).toHaveLength(1)
  })

  it('filters by time range', () => {
    const scans = [
      makeScan({ timestamp: Date.now() }),
      makeScan({ timestamp: Date.now() - 8 * 86_400_000 }),
    ]
    const filtered = filterScans(scans, { days: 7 })
    expect(filtered).toHaveLength(1)
  })
})

describe('extractHostname', () => {
  it('extracts hostname from URL', () => {
    expect(extractHostname('https://example.com/path')).toBe('example.com')
  })

  it('handles malformed URLs', () => {
    expect(extractHostname('not-a-url')).toBe('not-a-url')
  })
})
