import type { ScanResult, ScanTarget, RiskLevel, RiskScore } from '../types/scan'
import { detectPII } from './pii-detector'
import { detectPromptInjections } from './injection-detector'
import { detectHiddenContent } from './hidden-content-detector'
import { sanitizeContext } from './context-sanitizer'
import { crossValidate } from './cross-validator'
import { runOCR, createSkippedResult } from './ocr'
import { correlate } from './correlation'
import { assessRisk } from './risk-engine'
import { aggregateFindings } from './findings'

const MAX_DOM_LENGTH = 2_000_000

let activeScanId: string | null = null

function computeRisk(result: Pick<ScanResult, 'piiMatches' | 'promptInjections' | 'hiddenContent' | 'crossValidation'>): RiskScore {
  const privacyScore = Math.min(result.piiMatches.length * 20, 100)
  const injectionScore = result.promptInjections.reduce((sum, inj) => {
    const weights = { low: 10, medium: 25, high: 50, critical: 80 }
    return sum + weights[inj.severity]
  }, 0)
  const hiddenScore = Math.min(result.hiddenContent.length * 15, 100)

  let visualAnomalyScore = 0
  if (result.crossValidation) {
    const cv = result.crossValidation
    for (const anomaly of cv.anomalies) {
      const weights: Record<RiskLevel, number> = { none: 0, low: 5, medium: 15, high: 35, critical: 60 }
      visualAnomalyScore += weights[anomaly.severity]
    }
    visualAnomalyScore = Math.min(visualAnomalyScore, 100)
  }

  const max = Math.max(privacyScore, injectionScore, hiddenScore, visualAnomalyScore)
  let overall: RiskLevel = 'none'
  if (max > 0) overall = 'low'
  if (max >= 30) overall = 'medium'
  if (max >= 60) overall = 'high'
  if (max >= 80) overall = 'critical'

  return {
    overall,
    privacy: Math.min(privacyScore, 100),
    injection: Math.min(injectionScore, 100),
    hidden: Math.min(hiddenScore, 100),
    visualAnomaly: visualAnomalyScore,
  }
}

function truncateDOM(dom: string): string {
  if (dom.length <= MAX_DOM_LENGTH) return dom
  return dom.slice(0, MAX_DOM_LENGTH)
}

export function scan(target: ScanTarget): ScanResult {
  const dom = truncateDOM(target.dom)
  const piiMatches = detectPII(dom)
  const promptInjections = detectPromptInjections(dom)
  const hiddenContent = detectHiddenContent(dom)

  const crossValidation = crossValidate(
    dom,
    target.screenshot,
    hiddenContent,
    promptInjections,
  )

  const risk = computeRisk({ piiMatches, promptInjections, hiddenContent, crossValidation })

  const sanitization = sanitizeContext(dom, piiMatches, promptInjections, hiddenContent)
  const sanitizedContext = sanitization.structuredContext

  const scanResult: ScanResult = {
    id: crypto.randomUUID(),
    url: target.url,
    timestamp: Date.now(),
    piiMatches,
    promptInjections,
    hiddenContent,
    crossValidation,
    ocrResult: null,
    correlationResult: null,
    risk,
    riskAssessment: null,
    findings: [],
    sanitizedContext,
  }
  scanResult.riskAssessment = assessRisk(scanResult)
  scanResult.findings = aggregateFindings(scanResult)
  return scanResult
}

export async function scanWithOCR(
  target: ScanTarget,
  onOCRStatus?: (status: string) => void,
  signal?: AbortSignal,
): Promise<ScanResult> {
  const result = scan(target)
  const scanId = result.id
  activeScanId = scanId

  if (signal?.aborted) return result

  if (!target.screenshot) {
    result.ocrResult = createSkippedResult()
    return result
  }

  try {
    onOCRStatus?.('loading')
    onOCRStatus?.('processing')
    const ocrResult = await runOCR(target.screenshot, signal)

    if (activeScanId !== scanId) return result

    result.ocrResult = ocrResult

    result.correlationResult = correlate(
      truncateDOM(target.dom),
      ocrResult,
      result.piiMatches,
      result.promptInjections,
      result.hiddenContent,
    )
  } catch {
    result.ocrResult = {
      text: '',
      confidence: 0,
      blocks: [],
      status: 'error',
      error: 'OCR failed unexpectedly',
      processingTimeMs: 0,
    }
  }

  if (activeScanId !== scanId) return result

  result.riskAssessment = assessRisk(result)
  result.findings = aggregateFindings(result)
  return result
}

export function cancelActiveScan(): void {
  activeScanId = null
}
