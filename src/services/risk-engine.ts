import type {
  ScanResult,
  RiskLevel,
  RiskCategory,
  RiskContribution,
  RiskAssessment,
} from '../types/scan'

function scoreToLevel(score: number): RiskLevel {
  if (score >= 75) return 'critical'
  if (score >= 50) return 'high'
  if (score >= 25) return 'medium'
  if (score > 0) return 'low'
  return 'none'
}

const SEVERITY_WEIGHT: Record<string, number> = {
  none: 0,
  low: 10,
  medium: 25,
  high: 50,
  critical: 80,
}

export function assessRisk(result: ScanResult): RiskAssessment {
  const contributions: RiskContribution[] = []
  const seen = new Set<string>()

  // Privacy contributions from PII matches
  for (const pii of result.piiMatches) {
    const key = `pii:${pii.type}`
    if (seen.has(key)) continue
    seen.add(key)
    const count = result.piiMatches.filter(p => p.type === pii.type).length
    const base = SEVERITY_WEIGHT[pii.risk] || 10
    // Multiple of the same type boosts confidence, not raw score
    const score = Math.min(base + (count > 1 ? 5 : 0), 100)
    contributions.push({
      source: `PII: ${pii.type}`,
      category: 'privacy',
      score,
      severity: pii.risk,
      detail: `${count} ${pii.type} match${count > 1 ? 'es' : ''} detected (${pii.detectedBy})`,
    })
  }

  // Privacy contributions from correlation (visual PII/credential/OTP/payment)
  if (result.correlationResult) {
    for (const finding of result.correlationResult.findings) {
      if (finding.type === 'VISUAL_PII_REQUEST' || finding.type === 'VISUAL_CREDENTIAL_REQUEST' ||
          finding.type === 'VISUAL_OTP_REQUEST' || finding.type === 'VISUAL_PAYMENT_REQUEST') {
        const key = `corr:${finding.type}`
        if (seen.has(key)) continue
        seen.add(key)
        contributions.push({
          source: `Visual: ${finding.type}`,
          category: 'privacy',
          score: SEVERITY_WEIGHT[finding.severity] || 25,
          severity: finding.severity as RiskLevel,
          detail: finding.explanation,
        })
      }
    }
  }

  // Injection contributions
  for (const inj of result.promptInjections) {
    const key = `inj:${inj.type}:${inj.content.slice(0, 50)}`
    if (seen.has(key)) continue
    seen.add(key)
    contributions.push({
      source: `Injection: ${inj.type}`,
      category: 'injection',
      score: SEVERITY_WEIGHT[inj.severity] || 25,
      severity: inj.severity as RiskLevel,
      detail: `${inj.type} prompt injection: "${inj.content.slice(0, 80)}"`,
    })
  }

  // Cross-modal injection from correlation
  if (result.correlationResult) {
    for (const finding of result.correlationResult.findings) {
      if (finding.type === 'CROSS_MODAL_INJECTION') {
        const key = `corr:CROSS_MODAL_INJECTION`
        if (seen.has(key)) continue
        seen.add(key)
        // Boost existing injection score rather than double-counting
        const existingInj = contributions.find(c => c.category === 'injection')
        if (existingInj) {
          existingInj.score = Math.min(existingInj.score + 15, 100)
          existingInj.detail += ' (confirmed visually)'
        } else {
          contributions.push({
            source: 'Visual: CROSS_MODAL_INJECTION',
            category: 'injection',
            score: SEVERITY_WEIGHT[finding.severity] || 80,
            severity: finding.severity as RiskLevel,
            detail: finding.explanation,
          })
        }
      }
    }
  }

  // Deception contributions from hidden content
  for (const hidden of result.hiddenContent) {
    const key = `hidden:${hidden.selector}`
    if (seen.has(key)) continue
    seen.add(key)
    contributions.push({
      source: `Hidden: ${hidden.technique}`,
      category: 'deception',
      score: 15,
      severity: 'medium',
      detail: `Content hidden via ${hidden.technique} in ${hidden.element} (${hidden.selector})`,
    })
  }

  // Deception from cross-validation anomalies
  if (result.crossValidation) {
    for (const anomaly of result.crossValidation.anomalies) {
      const key = `cv:${anomaly.type}:${anomaly.selector}`
      if (seen.has(key)) continue
      seen.add(key)
      // Check if this anomaly overlaps with hidden content already counted
      const overlapsHidden = result.hiddenContent.some(h => h.selector === anomaly.selector)
      const score = overlapsHidden
        ? Math.min(SEVERITY_WEIGHT[anomaly.severity] || 15, 40)
        : SEVERITY_WEIGHT[anomaly.severity] || 15
      contributions.push({
        source: `Anomaly: ${anomaly.type}`,
        category: 'deception',
        score,
        severity: anomaly.severity,
        detail: anomaly.reason,
      })
    }
  }

  // Visual mismatch from correlation
  if (result.correlationResult) {
    for (const finding of result.correlationResult.findings) {
      if (finding.type === 'VISUAL_DOM_MISMATCH' || finding.type === 'HIDDEN_CONTENT_MISMATCH') {
        const key = `corr:${finding.type}:${finding.evidence.dom?.selector || 'visual'}`
        if (seen.has(key)) continue
        seen.add(key)
        contributions.push({
          source: `Visual: ${finding.type}`,
          category: 'deception',
          score: SEVERITY_WEIGHT[finding.severity] || 15,
          severity: finding.severity as RiskLevel,
          detail: finding.explanation,
        })
      }
    }
  }

  // Calculate category scores (max of contributions per category)
  const categoryScores: Record<RiskCategory, number> = { privacy: 0, injection: 0, deception: 0, overall: 0 }
  for (const c of contributions) {
    if (c.category !== 'overall') {
      categoryScores[c.category] = Math.max(categoryScores[c.category], c.score)
    }
  }

  // Overall = weighted combination: injection weighted highest (security threat), then privacy, then deception
  const overall = Math.min(
    Math.round(categoryScores.injection * 0.4 + categoryScores.privacy * 0.35 + categoryScores.deception * 0.25),
    100,
  )
  categoryScores.overall = overall

  // Confidence: based on number of signals and their agreement
  const signalCount = contributions.length
  const hasMultipleCategories = new Set(contributions.map(c => c.category)).size > 1
  const hasCorroboration = result.correlationResult !== null && result.correlationResult.findings.length > 0
  let confidence = 0.5
  if (signalCount >= 2) confidence += 0.15
  if (signalCount >= 4) confidence += 0.1
  if (hasMultipleCategories) confidence += 0.1
  if (hasCorroboration) confidence += 0.15
  if (signalCount === 0) confidence = 1.0 // no findings = high confidence it's safe
  confidence = Math.min(confidence, 1.0)

  const level = scoreToLevel(overall)
  const categories = {
    privacy: { score: categoryScores.privacy, level: scoreToLevel(categoryScores.privacy) },
    injection: { score: categoryScores.injection, level: scoreToLevel(categoryScores.injection) },
    deception: { score: categoryScores.deception, level: scoreToLevel(categoryScores.deception) },
    overall: { score: overall, level },
  }

  return {
    score: overall,
    level,
    confidence: Math.round(confidence * 100) / 100,
    categories,
    contributions,
    explanation: generateExplanation(contributions, level, categories),
    recommendation: generateRecommendation(level, categories),
  }
}

function generateExplanation(
  contributions: RiskContribution[],
  level: RiskLevel,
  categories: Record<RiskCategory, { score: number; level: RiskLevel }>,
): string {
  if (contributions.length === 0) {
    return 'No security threats detected. The page appears safe for AI agent interaction.'
  }

  const parts: string[] = []
  parts.push(`Overall risk: ${level.toUpperCase()} (score ${categories.overall.score}/100).`)

  if (categories.privacy.score > 0) {
    const privacyItems = contributions.filter(c => c.category === 'privacy')
    parts.push(`Privacy risk is ${categories.privacy.level} — ${privacyItems.length} finding${privacyItems.length > 1 ? 's' : ''} detected.`)
  }
  if (categories.injection.score > 0) {
    const injItems = contributions.filter(c => c.category === 'injection')
    parts.push(`Injection risk is ${categories.injection.level} — ${injItems.length} finding${injItems.length > 1 ? 's' : ''} detected.`)
  }
  if (categories.deception.score > 0) {
    const decItems = contributions.filter(c => c.category === 'deception')
    parts.push(`Deception risk is ${categories.deception.level} — ${decItems.length} finding${decItems.length > 1 ? 's' : ''} detected.`)
  }

  return parts.join(' ')
}

function generateRecommendation(
  level: RiskLevel,
  categories: Record<RiskCategory, { score: number; level: RiskLevel }>,
): string {
  if (level === 'none') {
    return 'No action required. This page is safe for AI agent browsing.'
  }
  if (level === 'low') {
    return 'Low risk detected. Review flagged items before allowing AI agent access. Standard sanitization should be sufficient.'
  }

  const actions: string[] = []
  if (categories.privacy.score >= 25) {
    actions.push('Redact or mask all detected PII before sharing with AI agents.')
  }
  if (categories.injection.score >= 25) {
    actions.push('Block AI agent interaction — prompt injection content detected.')
  }
  if (categories.deception.score >= 25) {
    actions.push('Investigate hidden/deceptive content before proceeding.')
  }

  if (level === 'critical') {
    return 'CRITICAL: Do not allow AI agent access to this page. ' + actions.join(' ')
  }
  if (level === 'high') {
    return 'HIGH RISK: Proceed with extreme caution. ' + actions.join(' ')
  }
  // medium
  return 'MODERATE RISK: Review findings carefully. ' + actions.join(' ')
}
