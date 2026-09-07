import type {
  ScanResult,
  SecurityFinding,
  EvidenceItem,
  EvidenceStrength,
  RiskLevel,
  RiskCategory,
  PIIMatch,
  PromptInjection,
  HiddenContent,
  CorrelationFinding,
  CrossValidationAnomaly,
} from '../types/scan'

let findingCounter = 0
function nextId(): string {
  return `f-${++findingCounter}-${Date.now().toString(36)}`
}

function severityRank(s: RiskLevel): number {
  const order: Record<RiskLevel, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 }
  return order[s]
}

function maxSeverity(a: RiskLevel, b: RiskLevel): RiskLevel {
  return severityRank(a) >= severityRank(b) ? a : b
}

function evidenceStrength(evidence: EvidenceItem[]): EvidenceStrength {
  const sources = new Set(evidence.map(e => e.source))
  if (sources.has('CORRELATION') || (sources.has('DOM') && sources.has('OCR'))) return 'CROSS_MODAL'
  if (sources.size > 1) return 'MULTI_SOURCE'
  return 'SINGLE_SOURCE'
}

const PII_LABELS: Record<string, string> = {
  email: 'Email Address',
  phone: 'Phone Number',
  ssn: 'Social Security Number',
  credit_card: 'Credit Card Number',
  address: 'Physical Address',
  name: 'Personal Name',
  date_of_birth: 'Date of Birth',
  pan: 'PAN Card Number',
  aadhaar: 'Aadhaar Number',
  bank_account: 'Bank Account Info',
  upi_id: 'UPI Identifier',
  password_field: 'Password Field',
  api_key: 'API Key / Secret',
  session_id: 'Session Token',
  custom: 'Sensitive Data',
}

function piiToFinding(pii: PIIMatch): SecurityFinding {
  const evidence: EvidenceItem[] = [{
    source: 'DOM',
    label: 'DOM Detection',
    detail: `${pii.detectedBy} detected ${pii.type}: "${pii.redacted}"`,
    selector: pii.location.selector,
    element: pii.elementTag,
  }]
  return {
    id: nextId(),
    title: PII_LABELS[pii.type] || `PII: ${pii.type}`,
    category: 'privacy',
    severity: pii.risk,
    confidence: pii.confidence,
    description: `${PII_LABELS[pii.type] || pii.type} detected in the page. ${pii.action}`,
    evidence,
    evidenceStrength: 'SINGLE_SOURCE',
    recommendation: pii.action,
  }
}

function injectionToFinding(inj: PromptInjection): SecurityFinding {
  const evidence: EvidenceItem[] = [{
    source: 'DOM',
    label: 'DOM Detection',
    detail: `${inj.type} prompt injection: "${inj.content.slice(0, 120)}"`,
    selector: inj.location.selector,
  }]
  return {
    id: nextId(),
    title: `Prompt Injection (${inj.type})`,
    category: 'injection',
    severity: inj.severity as RiskLevel,
    confidence: inj.severity === 'critical' ? 0.95 : inj.severity === 'high' ? 0.9 : 0.8,
    description: `A ${inj.type} prompt injection was detected: "${inj.content.slice(0, 80)}"`,
    evidence,
    evidenceStrength: 'SINGLE_SOURCE',
    recommendation: inj.severity === 'critical' || inj.severity === 'high'
      ? 'Block AI agent interaction — prompt injection content detected.'
      : 'Review before allowing AI agent access.',
  }
}

function hiddenToFinding(hidden: HiddenContent): SecurityFinding {
  const evidence: EvidenceItem[] = [{
    source: 'DOM',
    label: 'Hidden Content',
    detail: `Content hidden via ${hidden.technique} in <${hidden.element}>`,
    selector: hidden.selector,
    element: hidden.element,
    visibility: hidden.technique,
  }]
  return {
    id: nextId(),
    title: `Hidden Content (${hidden.technique})`,
    category: 'deception',
    severity: 'medium',
    confidence: 0.85,
    description: `Content hidden via ${hidden.technique}: "${hidden.content.slice(0, 100)}"`,
    evidence,
    evidenceStrength: 'SINGLE_SOURCE',
    recommendation: 'Investigate hidden content before proceeding.',
  }
}

function anomalyToFinding(anomaly: CrossValidationAnomaly): SecurityFinding {
  const evidence: EvidenceItem[] = [{
    source: 'CROSS_VALIDATION',
    label: 'Cross-Validation',
    detail: anomaly.reason,
    selector: anomaly.selector,
    visibility: anomaly.technique ?? undefined,
  }]
  return {
    id: nextId(),
    title: anomaly.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    category: 'deception',
    severity: anomaly.severity,
    confidence: anomaly.severity === 'critical' ? 0.95 : 0.85,
    description: anomaly.reason,
    evidence,
    evidenceStrength: 'SINGLE_SOURCE',
    recommendation: anomaly.severity === 'critical'
      ? 'Do not allow AI agent access — hidden agent-targeting instructions detected.'
      : 'Investigate hidden/deceptive content before proceeding.',
  }
}

function correlationToFinding(corr: CorrelationFinding): SecurityFinding {
  const evidence: EvidenceItem[] = []
  if (corr.evidence.visual) {
    evidence.push({
      source: 'OCR',
      label: 'Visual / OCR',
      detail: `"${corr.evidence.visual.ocrText}"`,
      ocrText: corr.evidence.visual.ocrText,
      ocrConfidence: corr.evidence.visual.ocrConfidence,
      boundingBox: corr.evidence.visual.boundingBox,
    })
  }
  if (corr.evidence.dom) {
    evidence.push({
      source: 'DOM',
      label: 'DOM Element',
      detail: `<${corr.evidence.dom.element}> ${corr.evidence.dom.matchedText}`,
      selector: corr.evidence.dom.selector,
      element: corr.evidence.dom.element,
      attributes: corr.evidence.dom.attributes,
    })
  }
  evidence.push({
    source: 'CORRELATION',
    label: 'Cross-Modal Correlation',
    detail: corr.explanation,
  })

  const category: RiskCategory =
    corr.type === 'CROSS_MODAL_INJECTION' ? 'injection'
    : corr.type === 'VISUAL_DOM_MISMATCH' || corr.type === 'HIDDEN_CONTENT_MISMATCH' ? 'deception'
    : 'privacy'

  return {
    id: nextId(),
    title: corr.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    category,
    severity: corr.severity as RiskLevel,
    confidence: corr.confidence,
    description: corr.explanation,
    evidence,
    evidenceStrength: evidenceStrength(evidence),
    recommendation: corr.severity === 'critical'
      ? 'Block AI agent interaction — high-severity cross-modal finding.'
      : 'Review finding before allowing AI agent access.',
  }
}

// Merge key: identifies findings that describe the same underlying issue
function mergeKey(f: SecurityFinding): string {
  // Correlation findings about credential/PII requests should merge with DOM PII findings
  const title = f.title.toLowerCase()
  if (title.includes('visual credential request')) return 'merge:credential'
  if (title.includes('visual pii request')) return 'merge:pii-visual'
  if (title.includes('visual otp request')) return 'merge:otp'
  if (title.includes('visual payment request')) return 'merge:payment'
  if (title.includes('cross modal injection')) return 'merge:injection-cross'
  if (f.category === 'privacy' && title.includes('password')) return 'merge:credential'
  // Hidden content + cross-validation for same selector
  const selector = f.evidence[0]?.selector
  if (selector && f.category === 'deception') return `merge:deception:${selector}`
  return `unique:${f.id}`
}

function mergeFindings(a: SecurityFinding, b: SecurityFinding): SecurityFinding {
  const allEvidence = [...a.evidence]
  for (const e of b.evidence) {
    const isDup = allEvidence.some(
      ex => ex.source === e.source && ex.detail === e.detail
    )
    if (!isDup) allEvidence.push(e)
  }
  return {
    id: a.id,
    title: severityRank(a.severity) >= severityRank(b.severity) ? a.title : b.title,
    category: a.category,
    severity: maxSeverity(a.severity, b.severity),
    confidence: Math.max(a.confidence, b.confidence),
    description: severityRank(a.severity) >= severityRank(b.severity) ? a.description : b.description,
    evidence: allEvidence,
    evidenceStrength: evidenceStrength(allEvidence),
    recommendation: severityRank(a.severity) >= severityRank(b.severity) ? a.recommendation : b.recommendation,
  }
}

export function aggregateFindings(result: ScanResult): SecurityFinding[] {
  const raw: SecurityFinding[] = []

  for (const pii of result.piiMatches) {
    raw.push(piiToFinding(pii))
  }
  for (const inj of result.promptInjections) {
    raw.push(injectionToFinding(inj))
  }
  for (const hidden of result.hiddenContent) {
    raw.push(hiddenToFinding(hidden))
  }
  if (result.crossValidation) {
    for (const anomaly of result.crossValidation.anomalies) {
      raw.push(anomalyToFinding(anomaly))
    }
  }
  if (result.correlationResult) {
    for (const corr of result.correlationResult.findings) {
      raw.push(correlationToFinding(corr))
    }
  }

  // Deduplicate by merge key
  const merged = new Map<string, SecurityFinding>()
  for (const f of raw) {
    const key = mergeKey(f)
    const existing = merged.get(key)
    if (existing) {
      merged.set(key, mergeFindings(existing, f))
    } else {
      merged.set(key, f)
    }
  }

  // Sort by severity (critical first)
  const findings = Array.from(merged.values())
  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))

  return findings
}
