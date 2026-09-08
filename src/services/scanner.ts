import type { ScanResult, ScanTarget, PIIMatch, RiskLevel, RiskScore } from '../types/scan'
import { detectPII } from './pii-detector'
import { detectPIIWithGLiNER, initGLiNER } from './gliner-pii-detector'
import { detectPromptInjections } from './injection-detector'
import { detectHiddenContent } from './hidden-content-detector'
import { sanitizeContext } from './context-sanitizer'
import { crossValidate } from './cross-validator'
import { runOCR, createSkippedResult } from './ocr'
import { correlate } from './correlation'
import { assessRisk } from './risk-engine'
import { aggregateFindings } from './findings'

// Begin model warm-up in the background as soon as this module is first imported.
initGLiNER()

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

// ---------------------------------------------------------------------------
// ML-augmented scan — merges regex + GLiNER results
// ---------------------------------------------------------------------------

/**
 * Deduplicate a combined list of regex + ML PII matches.
 *
 * An ML match is dropped when a regex match already covers the same category
 * and an identical (lowercased) value substring.  Regex matches are always
 * kept; ML matches add new entities the regex couldn't find (e.g. person
 * names, unstructured addresses).
 */
function mergePIIMatches(regexMatches: PIIMatch[], mlMatches: PIIMatch[]): PIIMatch[] {
  const seen = new Set<string>()
  const merged: PIIMatch[] = []

  for (const m of regexMatches) {
    const key = `${m.type}:${m.value.toLowerCase()}`
    seen.add(key)
    merged.push(m)
  }

  for (const m of mlMatches) {
    const key = `${m.type}:${m.value.toLowerCase()}`
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(m)
    }
  }

  // Re-sort by risk severity
  const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, none: 4 }
  merged.sort((a, b) => (riskOrder[a.risk] ?? 4) - (riskOrder[b.risk] ?? 4))

  return merged
}

/**
 * Full scan with ML augmentation.
 *
 * Runs the synchronous regex scan first, then augments with GLiNER-small NER.
 * If the model is unavailable (not yet downloaded or failed to load), the
 * function returns the regex-only result — it never fails because of ML.
 */
export async function scanWithML(
  target: ScanTarget,
  onMLStatus?: (status: string) => void,
  signal?: AbortSignal,
): Promise<ScanResult> {
  // 1. Synchronous regex-based scan (always runs)
  const result = scan(target)

  if (signal?.aborted) return result

  // 2. Async GLiNER inference
  try {
    onMLStatus?.('running')
    const mlMatches = await detectPIIWithGLiNER(target.dom)

    if (signal?.aborted) return result

    if (mlMatches.length > 0) {
      result.piiMatches = mergePIIMatches(result.piiMatches, mlMatches)

      // Re-compute derived fields that depend on piiMatches
      const sanitization = sanitizeContext(
        target.dom,
        result.piiMatches,
        result.promptInjections,
        result.hiddenContent,
      )
      result.sanitizedContext = sanitization.structuredContext
      result.risk = computeRisk(result)
      result.riskAssessment = assessRisk(result)
      result.findings = aggregateFindings(result)
    }

    onMLStatus?.('done')
  } catch {
    // ML inference failures are non-fatal — regex results are already in result
    onMLStatus?.('error')
  }

  return result
}
