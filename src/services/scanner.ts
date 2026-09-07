import type { ScanResult, ScanTarget, RiskLevel, RiskScore } from '../types/scan'
import { detectPII } from './pii-detector'
import { detectPromptInjections } from './injection-detector'
import { detectHiddenContent } from './hidden-content-detector'
import { sanitizeContext } from './context-sanitizer'
import { crossValidate } from './cross-validator'
import { runOCR, createSkippedResult } from './ocr'
import { correlate } from './correlation'

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

export function scan(target: ScanTarget): ScanResult {
  const piiMatches = detectPII(target.dom)
  const promptInjections = detectPromptInjections(target.dom)
  const hiddenContent = detectHiddenContent(target.dom)

  const crossValidation = crossValidate(
    target.dom,
    target.screenshot,
    hiddenContent,
    promptInjections,
  )

  const risk = computeRisk({ piiMatches, promptInjections, hiddenContent, crossValidation })

  const sanitization = sanitizeContext(target.dom, piiMatches, promptInjections, hiddenContent)
  const sanitizedContext = sanitization.structuredContext

  return {
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
    sanitizedContext,
  }
}

export async function scanWithOCR(
  target: ScanTarget,
  onOCRStatus?: (status: string) => void,
): Promise<ScanResult> {
  const result = scan(target)

  if (!target.screenshot) {
    result.ocrResult = createSkippedResult()
    return result
  }

  try {
    onOCRStatus?.('loading')
    onOCRStatus?.('processing')
    const ocrResult = await runOCR(target.screenshot)
    result.ocrResult = ocrResult

    result.correlationResult = correlate(
      target.dom,
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

  return result
}
