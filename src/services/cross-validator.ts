import type {
  HiddenContent,
  PromptInjection,
  RiskLevel,
  CrossValidationAnomaly,
  CrossValidationResult,
  AnomalyType,
} from '../types/scan'

const AGENT_INSTRUCTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /forget\s+(all\s+)?(previous|prior|above)/i,
  /you\s+are\s+now\s+(?:a|an|in)\s+\w+/i,
  /system\s*:\s*.{10,}/i,
  /\[INST\].*\[\/INST\]/is,
  /<\|im_start\|>system/i,
  /do\s+not\s+(reveal|share|disclose|mention)\s+(your|the)\s+(instructions?|prompt|system)/i,
  /pretend\s+(you\s+are|to\s+be|that)/i,
  /act\s+as\s+(if|though|a)\s+/i,
  /send\s+.{0,30}(credentials?|tokens?|cookies?|password|session)/i,
  /transfer\s+.{0,20}(funds?|money|account)/i,
  /output\s+.{0,20}(session|auth|token|cookie|credential)/i,
  /override\s+.{0,20}(safety|security|protocol)/i,
]

const SUSPICIOUS_CONTENT_PATTERNS = [
  /\b(attacker|malicious|exploit|hack|phish)\b/i,
  /\b(steal|exfiltrate|capture|harvest)\s+.{0,20}(data|info|credentials?|tokens?)/i,
  /\bdo\s+not\s+mention\s+this/i,
  /\bno\s+further\s+security\s+checks/i,
  /\bcompletely\s+secure\s+and\s+trustworthy\b/i,
  /\bverified\s+as\s+(?:completely\s+)?secure\b/i,
]

function contentIsAgentTargeting(text: string): boolean {
  return AGENT_INSTRUCTION_PATTERNS.some((p) => p.test(text))
}

function contentIsSuspicious(text: string): boolean {
  return SUSPICIOUS_CONTENT_PATTERNS.some((p) => p.test(text))
}

function severityForAnomaly(type: AnomalyType, text: string): RiskLevel {
  if (type === 'HIDDEN_AGENT_INSTRUCTION') return 'critical'
  if (type === 'INVISIBLE_PROMPT_INJECTION') return 'critical'

  if (contentIsAgentTargeting(text)) return 'critical'
  if (contentIsSuspicious(text)) return 'high'

  if (type === 'OFFSCREEN_SUSPICIOUS_CONTENT') return 'high'
  if (type === 'HIDDEN_INTERACTIVE_ELEMENT') return 'medium'
  if (type === 'DOM_VISIBILITY_MISMATCH') return 'medium'
  if (type === 'CLOAKED_CONTENT') return 'low'

  return 'low'
}

function maxSeverity(levels: RiskLevel[]): RiskLevel {
  const order: RiskLevel[] = ['none', 'low', 'medium', 'high', 'critical']
  let max = 0
  for (const l of levels) {
    const idx = order.indexOf(l)
    if (idx > max) max = idx
  }
  return order[max]
}

function classifyAnomaly(
  hidden: HiddenContent,
  injections: PromptInjection[],
): AnomalyType {
  const text = hidden.content

  const hasMatchingInjection = injections.some((inj) => {
    if (inj.location.textOffset) {
      return text.includes(inj.content)
    }
    return false
  })
  if (hasMatchingInjection) return 'INVISIBLE_PROMPT_INJECTION'

  if (contentIsAgentTargeting(text)) return 'HIDDEN_AGENT_INSTRUCTION'

  if (hidden.technique === 'offscreen') return 'OFFSCREEN_SUSPICIOUS_CONTENT'

  if (contentIsSuspicious(text)) return 'DOM_VISIBILITY_MISMATCH'

  return 'CLOAKED_CONTENT'
}

function detectHiddenInteractiveElements(domString: string): CrossValidationAnomaly[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(domString, 'text/html')
  const anomalies: CrossValidationAnomaly[] = []

  const interactiveSelectors = 'a[href], button, input[type="submit"], form[action]'
  const elements = doc.querySelectorAll(interactiveSelectors)

  for (const el of Array.from(elements)) {
    const htmlEl = el as HTMLElement
    const style = htmlEl.style
    const isHidden =
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      htmlEl.getAttribute('aria-hidden') === 'true' ||
      htmlEl.hidden

    if (!isHidden) {
      if (style.position === 'absolute' || style.position === 'fixed') {
        const left = parseFloat(style.left)
        const top = parseFloat(style.top)
        if (!(left < -1000 || top < -1000)) continue
      } else {
        continue
      }
    }

    const text = (htmlEl.textContent || '').trim()
    const href = el.getAttribute('href') || el.getAttribute('action') || ''
    const content = text || href
    if (!content) continue

    const selector = buildSelector(htmlEl)
    anomalies.push({
      type: 'HIDDEN_INTERACTIVE_ELEMENT',
      severity: contentIsAgentTargeting(content) ? 'critical' : 'medium',
      selector,
      content: content.slice(0, 300),
      technique: null,
      reason: `Hidden interactive element (${el.tagName.toLowerCase()}) could be activated by an AI agent without user visibility.`,
    })
  }

  return anomalies
}

function buildSelector(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase()
  if (el.id) return `${tag}#${el.id}`
  const cls = el.className?.toString?.().trim()
  if (cls) return `${tag}.${cls.split(/\s+/)[0]}`
  return tag
}

export function crossValidate(
  domString: string,
  screenshot: string | null,
  hiddenContent: HiddenContent[],
  injections: PromptInjection[],
): CrossValidationResult {
  const anomalies: CrossValidationAnomaly[] = []
  const domVisibilityMismatches: { selector: string; reason: string }[] = []

  for (const hidden of hiddenContent) {
    const text = hidden.content
    if (text.length < 5) continue

    const anomalyType = classifyAnomaly(hidden, injections)
    const severity = severityForAnomaly(anomalyType, text)

    const reason = buildReason(anomalyType, hidden)

    anomalies.push({
      type: anomalyType,
      severity,
      selector: hidden.selector,
      content: text.slice(0, 300),
      technique: hidden.technique,
      reason,
    })

    if (anomalyType !== 'CLOAKED_CONTENT') {
      domVisibilityMismatches.push({
        selector: hidden.selector,
        reason,
      })
    }
  }

  const interactiveAnomalies = detectHiddenInteractiveElements(domString)
  const existingSelectors = new Set(anomalies.map((a) => a.selector))
  for (const ia of interactiveAnomalies) {
    if (!existingSelectors.has(ia.selector)) {
      anomalies.push(ia)
    }
  }

  anomalies.sort((a, b) => {
    const order: RiskLevel[] = ['critical', 'high', 'medium', 'low', 'none']
    return order.indexOf(a.severity) - order.indexOf(b.severity)
  })

  const hiddenInjectionCount = anomalies.filter(
    (a) => a.type === 'INVISIBLE_PROMPT_INJECTION' || a.type === 'HIDDEN_AGENT_INSTRUCTION',
  ).length

  const invisibleContentCount = anomalies.filter(
    (a) => a.type !== 'CLOAKED_CONTENT',
  ).length

  const severity = anomalies.length > 0
    ? maxSeverity(anomalies.map((a) => a.severity))
    : 'none'

  return {
    anomalies,
    hiddenInjectionCount,
    invisibleContentCount,
    domVisibilityMismatches,
    severity,
    hasScreenshot: screenshot != null,
  }
}

function buildReason(type: AnomalyType, hidden: HiddenContent): string {
  const techniqueLabel: Record<HiddenContent['technique'], string> = {
    display_none: 'display:none',
    visibility_hidden: 'visibility:hidden',
    zero_size: 'zero-size element',
    offscreen: 'positioned off-screen',
    opacity_zero: 'opacity:0',
    overflow_hidden: 'overflow clipped',
    aria_hidden: 'aria-hidden',
  }
  const tech = techniqueLabel[hidden.technique]

  switch (type) {
    case 'HIDDEN_AGENT_INSTRUCTION':
      return `Agent-targeting instructions exist in DOM content (${tech}) that is not presented as visible webpage content.`
    case 'INVISIBLE_PROMPT_INJECTION':
      return `Prompt injection detected in hidden element (${tech}). This content is invisible to the user but would be processed by an AI agent reading the DOM.`
    case 'OFFSCREEN_SUSPICIOUS_CONTENT':
      return `Suspicious content positioned off-screen where users cannot see it, but AI agents parsing the DOM would process it.`
    case 'DOM_VISIBILITY_MISMATCH':
      return `DOM contains suspicious content (${tech}) that does not appear in the visible page — potential attempt to manipulate AI agent behavior.`
    case 'HIDDEN_INTERACTIVE_ELEMENT':
      return `Hidden interactive element could be activated by an AI agent without user visibility.`
    case 'CLOAKED_CONTENT':
      return `Content hidden via ${tech}. Not flagged as malicious but invisible to the user.`
  }
}
