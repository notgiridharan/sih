import { describe, it, expect } from 'vitest'
import { assessRisk } from './risk-engine'
import type { ScanResult } from '../types/scan'

function baseScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    id: 'test',
    url: 'https://example.com',
    timestamp: Date.now(),
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

describe('risk-engine', () => {
  it('returns none/0 for clean page', () => {
    const result = assessRisk(baseScanResult())
    expect(result.score).toBe(0)
    expect(result.level).toBe('none')
    expect(result.contributions).toHaveLength(0)
    expect(result.confidence).toBe(1.0)
  })

  it('scores PII matches as privacy risk', () => {
    const result = assessRisk(baseScanResult({
      piiMatches: [
        { type: 'email', value: 'a@b.com', redacted: '***', location: { source: 'dom' }, confidence: 0.9, risk: 'high', action: 'redact', detectedBy: 'regex' },
      ],
    }))
    expect(result.categories.privacy.score).toBeGreaterThan(0)
    expect(result.categories.privacy.level).not.toBe('none')
    expect(result.contributions.some(c => c.category === 'privacy')).toBe(true)
  })

  it('scores prompt injections as injection risk', () => {
    const result = assessRisk(baseScanResult({
      promptInjections: [
        { type: 'direct', content: 'Ignore previous instructions', location: { source: 'dom' }, severity: 'critical' },
      ],
    }))
    expect(result.categories.injection.score).toBeGreaterThan(0)
    expect(result.level).not.toBe('none')
  })

  it('scores hidden content as deception risk', () => {
    const result = assessRisk(baseScanResult({
      hiddenContent: [
        { element: 'div', selector: '.hidden', technique: 'display_none', content: 'secret stuff here' },
      ],
    }))
    expect(result.categories.deception.score).toBeGreaterThan(0)
    expect(result.contributions.some(c => c.category === 'deception')).toBe(true)
  })

  it('scores cross-validation anomalies as deception', () => {
    const result = assessRisk(baseScanResult({
      crossValidation: {
        anomalies: [
          { type: 'HIDDEN_AGENT_INSTRUCTION', severity: 'critical', selector: '.x', content: 'ignore', technique: 'display_none', reason: 'hidden agent instruction' },
        ],
        hiddenInjectionCount: 1,
        invisibleContentCount: 1,
        domVisibilityMismatches: [],
        severity: 'critical',
        hasScreenshot: false,
      },
    }))
    expect(result.categories.deception.score).toBeGreaterThan(0)
  })

  it('deduplicates same PII type', () => {
    const result = assessRisk(baseScanResult({
      piiMatches: [
        { type: 'email', value: 'a@b.com', redacted: '***', location: { source: 'dom' }, confidence: 0.9, risk: 'high', action: 'redact', detectedBy: 'regex' },
        { type: 'email', value: 'c@d.com', redacted: '***', location: { source: 'dom' }, confidence: 0.9, risk: 'high', action: 'redact', detectedBy: 'regex' },
      ],
    }))
    const privacyContribs = result.contributions.filter(c => c.source === 'PII: email')
    expect(privacyContribs).toHaveLength(1)
    expect(privacyContribs[0].detail).toContain('2 email matches')
  })

  it('cross-modal injection boosts existing injection rather than double-counting', () => {
    const result = assessRisk(baseScanResult({
      promptInjections: [
        { type: 'direct', content: 'Ignore all previous', location: { source: 'dom' }, severity: 'critical' },
      ],
      correlationResult: {
        findings: [
          { type: 'CROSS_MODAL_INJECTION', severity: 'critical', confidence: 0.95, explanation: 'cross modal', evidence: { visual: { ocrText: 'ignore', ocrConfidence: 0.9 }, dom: null } },
        ],
        totalCorrelations: 1,
        highestSeverity: 'critical',
      },
    }))
    const injContribs = result.contributions.filter(c => c.category === 'injection')
    expect(injContribs).toHaveLength(1)
    expect(injContribs[0].detail).toContain('confirmed visually')
  })

  it('maps score 0 to level none', () => {
    const result = assessRisk(baseScanResult())
    expect(result.level).toBe('none')
  })

  it('maps score 1-24 to level low', () => {
    const result = assessRisk(baseScanResult({
      piiMatches: [
        { type: 'phone', value: '555', redacted: '***', location: { source: 'dom' }, confidence: 0.5, risk: 'low', action: 'redact', detectedBy: 'regex' },
      ],
    }))
    expect(result.categories.privacy.score).toBeLessThan(25)
    expect(result.categories.privacy.level).toBe('low')
  })

  it('maps score 25-49 to level medium', () => {
    const result = assessRisk(baseScanResult({
      promptInjections: [
        { type: 'indirect', content: 'act as admin', location: { source: 'dom' }, severity: 'medium' },
      ],
    }))
    expect(result.categories.injection.score).toBe(25)
    expect(result.categories.injection.level).toBe('medium')
  })

  it('maps score 75+ to level critical', () => {
    const result = assessRisk(baseScanResult({
      promptInjections: [
        { type: 'direct', content: 'ignore', location: { source: 'dom' }, severity: 'critical' },
      ],
    }))
    expect(result.categories.injection.score).toBe(80)
    expect(result.categories.injection.level).toBe('critical')
  })

  it('generates explanation from findings', () => {
    const result = assessRisk(baseScanResult({
      piiMatches: [
        { type: 'email', value: 'a@b.com', redacted: '***', location: { source: 'dom' }, confidence: 0.9, risk: 'high', action: 'redact', detectedBy: 'regex' },
      ],
    }))
    expect(result.explanation).toContain('Privacy risk')
    expect(result.explanation).toContain('Overall risk')
  })

  it('generates safe explanation for clean page', () => {
    const result = assessRisk(baseScanResult())
    expect(result.explanation).toContain('safe')
  })

  it('generates recommendation per severity', () => {
    const clean = assessRisk(baseScanResult())
    expect(clean.recommendation).toContain('No action required')

    const critical = assessRisk(baseScanResult({
      promptInjections: [
        { type: 'direct', content: 'ignore', location: { source: 'dom' }, severity: 'critical' },
      ],
    }))
    expect(critical.recommendation).toContain('Block AI agent')
  })

  it('confidence increases with multiple signals', () => {
    const single = assessRisk(baseScanResult({
      piiMatches: [
        { type: 'email', value: 'a@b.com', redacted: '***', location: { source: 'dom' }, confidence: 0.9, risk: 'high', action: 'redact', detectedBy: 'regex' },
      ],
    }))
    const multi = assessRisk(baseScanResult({
      piiMatches: [
        { type: 'email', value: 'a@b.com', redacted: '***', location: { source: 'dom' }, confidence: 0.9, risk: 'high', action: 'redact', detectedBy: 'regex' },
        { type: 'phone', value: '555', redacted: '***', location: { source: 'dom' }, confidence: 0.9, risk: 'high', action: 'redact', detectedBy: 'regex' },
      ],
      promptInjections: [
        { type: 'direct', content: 'ignore', location: { source: 'dom' }, severity: 'high' },
      ],
    }))
    expect(multi.confidence).toBeGreaterThan(single.confidence)
  })

  it('overall score uses weighted combination', () => {
    const result = assessRisk(baseScanResult({
      piiMatches: [
        { type: 'credit_card', value: '4111', redacted: '***', location: { source: 'dom' }, confidence: 0.98, risk: 'critical', action: 'block', detectedBy: 'regex' },
      ],
      promptInjections: [
        { type: 'direct', content: 'ignore', location: { source: 'dom' }, severity: 'critical' },
      ],
      hiddenContent: [
        { element: 'div', selector: '.x', technique: 'display_none', content: 'hidden stuff' },
      ],
    }))
    // Overall should be less than max(all categories) due to weighted average
    const maxCat = Math.max(result.categories.privacy.score, result.categories.injection.score, result.categories.deception.score)
    expect(result.score).toBeLessThanOrEqual(maxCat)
    expect(result.score).toBeGreaterThan(0)
  })
})
