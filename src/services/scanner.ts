import type { ScanResult, ScanTarget, RiskLevel, RiskScore } from '../types/scan'
import { detectPII } from './pii-detector'
import { detectPromptInjections } from './injection-detector'
import { detectHiddenContent } from './hidden-content-detector'
import { sanitizeContext } from './context-sanitizer'

function computeRisk(result: Pick<ScanResult, 'piiMatches' | 'promptInjections' | 'hiddenContent'>): RiskScore {
  const privacyScore = Math.min(result.piiMatches.length * 20, 100)
  const injectionScore = result.promptInjections.reduce((sum, inj) => {
    const weights = { low: 10, medium: 25, high: 50, critical: 80 }
    return sum + weights[inj.severity]
  }, 0)
  const hiddenScore = Math.min(result.hiddenContent.length * 15, 100)

  const max = Math.max(privacyScore, injectionScore, hiddenScore)
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
  }
}

export function scan(target: ScanTarget): ScanResult {
  const piiMatches = detectPII(target.dom)
  const promptInjections = detectPromptInjections(target.dom)
  const hiddenContent = detectHiddenContent(target.dom)

  const risk = computeRisk({ piiMatches, promptInjections, hiddenContent })

  const sanitization = sanitizeContext(target.dom, piiMatches, promptInjections, hiddenContent)
  const sanitizedContext = sanitization.structuredContext

  return {
    id: crypto.randomUUID(),
    url: target.url,
    timestamp: Date.now(),
    piiMatches,
    promptInjections,
    hiddenContent,
    risk,
    sanitizedContext,
  }
}
