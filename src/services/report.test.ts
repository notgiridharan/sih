import { describe, it, expect } from 'vitest'
import { generateReport, serializeReport } from './report'
import type { ScanResult } from '../types/scan'

function baseScan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    id: 'test-rpt',
    url: 'https://shop.example.com/checkout',
    timestamp: 1700000000000,
    piiMatches: [],
    promptInjections: [],
    hiddenContent: [],
    crossValidation: null,
    ocrResult: null,
    correlationResult: null,
    risk: { overall: 'none', privacy: 0, injection: 0, hidden: 0, visualAnomaly: 0 },
    riskAssessment: {
      score: 45,
      level: 'medium',
      confidence: 0.75,
      categories: {
        privacy: { score: 50, level: 'high' },
        injection: { score: 0, level: 'none' },
        deception: { score: 15, level: 'low' },
        overall: { score: 45, level: 'medium' },
      },
      contributions: [],
      explanation: 'Test explanation',
      recommendation: 'Test recommendation',
    },
    findings: [],
    sanitizedContext: null,
    ...overrides,
  }
}

describe('report generation', () => {
  it('generates a report', () => {
    const report = generateReport(baseScan())
    expect(report.header).toBe('Sentinel Lens Security Report')
    expect(report.scan).toBeDefined()
    expect(report.risk).toBeDefined()
    expect(report.findings).toBeDefined()
    expect(report.summary).toBeDefined()
    expect(report.generatedAt).toBeGreaterThan(0)
  })

  it('has correct URL and hostname', () => {
    const report = generateReport(baseScan())
    expect(report.scan.url).toBe('https://shop.example.com/checkout')
    expect(report.scan.hostname).toBe('shop.example.com')
  })

  it('has correct timestamp', () => {
    const report = generateReport(baseScan())
    expect(report.scan.timestamp).toBe(1700000000000)
  })

  it('has correct risk score', () => {
    const report = generateReport(baseScan())
    expect(report.risk.score).toBe(45)
  })

  it('has correct risk level', () => {
    const report = generateReport(baseScan())
    expect(report.risk.level).toBe('medium')
  })

  it('includes findings when present', () => {
    const report = generateReport(baseScan({
      piiMatches: [
        { type: 'email', value: 'a@b.com', redacted: '***', location: { source: 'dom' }, confidence: 0.95, risk: 'high', action: 'Redact', detectedBy: 'regex' },
      ],
    }))
    expect(report.findings.length).toBeGreaterThan(0)
  })

  it('includes evidence in findings', () => {
    const report = generateReport(baseScan({
      piiMatches: [
        { type: 'email', value: 'a@b.com', redacted: '***', location: { source: 'dom' }, confidence: 0.95, risk: 'high', action: 'Redact', detectedBy: 'regex' },
      ],
    }))
    expect(report.findings[0].evidence.length).toBeGreaterThan(0)
  })

  it('empty report works', () => {
    const report = generateReport(baseScan())
    expect(report.findings).toHaveLength(0)
    expect(report.summary).toContain('No significant security findings')
  })

  it('JSON serialization succeeds', () => {
    const report = generateReport(baseScan({
      piiMatches: [
        { type: 'email', value: 'a@b.com', redacted: '***', location: { source: 'dom' }, confidence: 0.95, risk: 'high', action: 'Redact', detectedBy: 'regex' },
      ],
    }))
    const json = serializeReport(report)
    expect(json).toBeTruthy()
    const parsed = JSON.parse(json)
    expect(parsed.header).toBe('Sentinel Lens Security Report')
    expect(parsed.findings.length).toBeGreaterThan(0)
  })
})
