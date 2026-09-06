import type { PIIMatch, PIICategory, RiskLevel } from '../types/scan'

export interface DetectionRule {
  category: PIICategory
  detect: (text: string) => RawFinding[]
  risk: RiskLevel
  confidence: number
  action: string
  detectedBy: PIIMatch['detectedBy']
}

interface RawFinding {
  value: string
  start: number
  end: number
  confidence?: number
}

function regexFinder(pattern: RegExp): (text: string) => RawFinding[] {
  return (text: string) => {
    const re = new RegExp(pattern.source, pattern.flags)
    const out: RawFinding[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      out.push({ value: m[0], start: m.index, end: m.index + m[0].length })
    }
    return out
  }
}

function luhnCheck(num: string): boolean {
  const digits = num.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10)
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

function verhoeffCheck(num: string): boolean {
  const d = [
    [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
    [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
    [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
    [9,8,7,6,5,4,3,2,1,0],
  ]
  const p = [
    [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
    [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
    [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
  ]
  const digits = num.replace(/\D/g, '')
  let c = 0
  for (let i = digits.length - 1; i >= 0; i--) {
    c = d[c][p[(digits.length - 1 - i) % 8][parseInt(digits[i], 10)]]
  }
  return c === 0
}

const REGEX_RULES: DetectionRule[] = [
  {
    category: 'email',
    detect: regexFinder(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g),
    risk: 'high',
    confidence: 0.95,
    action: 'Redact before sharing with AI agent',
    detectedBy: 'regex',
  },
  {
    category: 'phone',
    detect: regexFinder(/\b(?:\+?\d{1,3}[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b/g),
    risk: 'high',
    confidence: 0.9,
    action: 'Redact or mask digits',
    detectedBy: 'regex',
  },
  {
    category: 'phone',
    detect: regexFinder(/\b(?:\+91[\s\-.]?)?[6-9]\d{4}[\s\-.]?\d{5}\b/g),
    risk: 'high',
    confidence: 0.88,
    action: 'Redact or mask digits',
    detectedBy: 'regex',
  },
  {
    category: 'ssn',
    detect: regexFinder(/\b\d{3}-\d{2}-\d{4}\b/g),
    risk: 'critical',
    confidence: 0.92,
    action: 'Block — do not transmit to AI agent',
    detectedBy: 'regex',
  },
  {
    category: 'credit_card',
    detect: (text: string) => {
      const raw = regexFinder(/\b(?:\d{4}[\s\-]?){3}\d{4}\b/g)(text)
      return raw.filter((f) => luhnCheck(f.value))
    },
    risk: 'critical',
    confidence: 0.95,
    action: 'Block — do not transmit to AI agent',
    detectedBy: 'regex',
  },
  {
    category: 'pan',
    detect: regexFinder(/\b[A-Z]{5}\d{4}[A-Z]\b/g),
    risk: 'critical',
    confidence: 0.9,
    action: 'Block — government ID must not be shared',
    detectedBy: 'regex',
  },
  {
    category: 'aadhaar',
    detect: (text: string) => {
      const raw = regexFinder(/\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g)(text)
      return raw.filter((f) => {
        const digits = f.value.replace(/\D/g, '')
        if (digits.length !== 12) return false
        if (/^[01]/.test(digits)) return false
        return verhoeffCheck(digits)
      }).map((f) => ({ ...f, confidence: 0.85 }))
    },
    risk: 'critical',
    confidence: 0.85,
    action: 'Block — government ID must not be shared',
    detectedBy: 'regex',
  },
  {
    category: 'upi_id',
    detect: regexFinder(/\b[a-zA-Z0-9.\-_]+@[a-z]{2,}(?:bank|pay|upi|paytm|ybl|okhdfcbank|okicici|oksbi|apl|axisbank|ibl|sbi|icici|hdfc)\b/gi),
    risk: 'high',
    confidence: 0.88,
    action: 'Redact before sharing',
    detectedBy: 'regex',
  },
  {
    category: 'bank_account',
    detect: (text: string) => {
      const findings: RawFinding[] = []
      const ifsc = regexFinder(/\b[A-Z]{4}0[A-Z0-9]{6}\b/g)(text)
      for (const f of ifsc) findings.push({ ...f, confidence: 0.85 })
      const routing = regexFinder(/\b0[0-9]{8}\b/g)(text)
      const routingContext = /routing|aba|transit/i
      for (const f of routing) {
        const ctx = text.slice(Math.max(0, f.start - 40), f.start)
        if (routingContext.test(ctx)) findings.push({ ...f, confidence: 0.7 })
      }
      const swift = regexFinder(/\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g)(text)
      const swiftContext = /swift|bic|bank/i
      for (const f of swift) {
        const ctx = text.slice(Math.max(0, f.start - 40), f.start)
        if (swiftContext.test(ctx)) findings.push({ ...f, confidence: 0.75 })
      }
      return findings
    },
    risk: 'critical',
    confidence: 0.8,
    action: 'Block — banking information must not be shared',
    detectedBy: 'regex',
  },
  {
    category: 'date_of_birth',
    detect: (text: string) => {
      const raw = regexFinder(/\b(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/g)(text)
      const dobContext = /\b(?:dob|birth|born|birthday|date\s*of\s*birth)\b/i
      return raw
        .filter((f) => {
          const ctx = text.slice(Math.max(0, f.start - 60), f.start)
          return dobContext.test(ctx)
        })
        .map((f) => ({ ...f, confidence: 0.8 }))
    },
    risk: 'high',
    confidence: 0.8,
    action: 'Redact — personal identifier',
    detectedBy: 'heuristic',
  },
  {
    category: 'api_key',
    detect: (text: string) => {
      const findings: RawFinding[] = []
      const patterns = [
        /\b(?:sk|pk|api|key|token|secret|bearer)[_\-]?[a-zA-Z0-9]{20,}\b/gi,
        /\bAIza[0-9A-Za-z_\-]{35}\b/g,
        /\bghp_[0-9A-Za-z]{36}\b/g,
        /\bsk-[a-zA-Z0-9]{20,}\b/g,
        /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
      ]
      for (const p of patterns) {
        findings.push(...regexFinder(p)(text))
      }
      return findings
    },
    risk: 'critical',
    confidence: 0.88,
    action: 'Block — credential must not be exposed',
    detectedBy: 'regex',
  },
  {
    category: 'session_id',
    detect: (text: string) => {
      const raw = regexFinder(/\b(?:sess|session|sid|jsessionid|phpsessid|csrf|xsrf)[_\-]?[=:]?\s*[a-f0-9]{16,}\b/gi)(text)
      return raw
    },
    risk: 'critical',
    confidence: 0.82,
    action: 'Block — session token must not be shared',
    detectedBy: 'regex',
  },
  {
    category: 'address',
    detect: (text: string) => {
      const raw = regexFinder(/\b\d{1,5}\s+[A-Z][a-zA-Z\s]{2,30}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Circle|Cir)\.?\s*(?:,\s*[A-Za-z\s]+,?\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)?\b/g)(text)
      return raw.map((f) => ({ ...f, confidence: 0.7 }))
    },
    risk: 'medium',
    confidence: 0.7,
    action: 'Consider redacting physical location',
    detectedBy: 'heuristic',
  },
]

function redact(value: string, type: PIICategory): string {
  const len = value.length
  switch (type) {
    case 'email': {
      const [local, domain] = value.split('@')
      return `${local[0]}${'*'.repeat(Math.max(local.length - 1, 2))}@${domain}`
    }
    case 'phone':
      return value.replace(/\d(?=\d{4})/g, '*')
    case 'ssn':
      return `***-**-${value.slice(-4)}`
    case 'credit_card':
      return value.replace(/\d(?=[\d\s\-]*\d{4}$)/g, '*').replace(/\*{2,}/g, (m) => m)
    case 'pan':
      return `${'*'.repeat(5)}${value.slice(5, 9)}${'*'}`
    case 'aadhaar':
      return `**** **** ${value.replace(/\D/g, '').slice(-4)}`
    case 'upi_id':
      return `${'*'.repeat(4)}@***`
    case 'bank_account':
      return `${'*'.repeat(Math.max(len - 4, 3))}${value.slice(-4)}`
    case 'date_of_birth':
      return '**/**/****'
    case 'api_key':
    case 'session_id':
      return `${value.slice(0, 4)}${'*'.repeat(Math.max(len - 8, 4))}${value.slice(-4)}`
    case 'address':
      return '[REDACTED ADDRESS]'
    case 'name':
      return `${value[0]}${'*'.repeat(Math.max(len - 1, 2))}`
    case 'password_field':
      return '[PASSWORD FIELD]'
    default:
      return '*'.repeat(Math.min(len, 8))
  }
}

function detectDOMFields(html: string): PIIMatch[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const matches: PIIMatch[] = []

  const passwordInputs = doc.querySelectorAll('input[type="password"]')
  for (const el of Array.from(passwordInputs)) {
    const selector = buildSelector(el)
    matches.push({
      type: 'password_field',
      value: '[password input]',
      redacted: '[PASSWORD FIELD]',
      location: { source: 'dom', selector },
      confidence: 1.0,
      risk: 'high',
      action: 'Ensure value is never captured or transmitted',
      elementTag: el.tagName.toLowerCase(),
      detectedBy: 'dom-inspection',
    })
  }

  const sensitiveInputPatterns: { pattern: RegExp; category: PIICategory; risk: RiskLevel; action: string }[] = [
    { pattern: /name|full.?name|first.?name|last.?name/i, category: 'name', risk: 'medium', action: 'Consider redacting personal name' },
    { pattern: /email|e-mail/i, category: 'email', risk: 'high', action: 'Redact before sharing' },
    { pattern: /phone|mobile|tel|cell/i, category: 'phone', risk: 'high', action: 'Redact or mask digits' },
    { pattern: /ssn|social.?sec/i, category: 'ssn', risk: 'critical', action: 'Block — do not transmit' },
    { pattern: /credit.?card|card.?num|cc.?num/i, category: 'credit_card', risk: 'critical', action: 'Block — do not transmit' },
    { pattern: /pan.?(?:card|num)|pan$/i, category: 'pan', risk: 'critical', action: 'Block — government ID' },
    { pattern: /aadhaar|aadhar|uidai/i, category: 'aadhaar', risk: 'critical', action: 'Block — government ID' },
    { pattern: /dob|birth|birthday/i, category: 'date_of_birth', risk: 'high', action: 'Redact date of birth' },
    { pattern: /upi|vpa/i, category: 'upi_id', risk: 'high', action: 'Redact UPI identifier' },
    { pattern: /account.?(?:no|num)|acct/i, category: 'bank_account', risk: 'critical', action: 'Block — banking info' },
    { pattern: /ifsc|routing|swift/i, category: 'bank_account', risk: 'critical', action: 'Block — banking info' },
    { pattern: /api.?key|secret|token/i, category: 'api_key', risk: 'critical', action: 'Block — credential' },
    { pattern: /address|street|city|zip|postal|pincode/i, category: 'address', risk: 'medium', action: 'Consider redacting address' },
  ]

  const inputs = doc.querySelectorAll('input, textarea, select')
  for (const el of Array.from(inputs)) {
    const name = (el.getAttribute('name') || '').toLowerCase()
    const id = (el.id || '').toLowerCase()
    const label = (el.getAttribute('aria-label') || '').toLowerCase()
    const placeholder = (el.getAttribute('placeholder') || '').toLowerCase()
    const combined = `${name} ${id} ${label} ${placeholder}`
    const type = (el.getAttribute('type') || '').toLowerCase()

    if (type === 'password' || type === 'hidden' || type === 'submit' || type === 'button') continue

    for (const rule of sensitiveInputPatterns) {
      if (rule.pattern.test(combined)) {
        const selector = buildSelector(el)
        const value = (el as HTMLInputElement).value || ''
        const hasValue = value.trim().length > 0

        matches.push({
          type: rule.category,
          value: hasValue ? value : `[${rule.category} field]`,
          redacted: hasValue ? redact(value, rule.category) : `[${rule.category.toUpperCase()} FIELD]`,
          location: { source: 'dom', selector },
          confidence: hasValue ? 0.92 : 0.75,
          risk: rule.risk,
          action: rule.action,
          elementTag: el.tagName.toLowerCase(),
          detectedBy: 'dom-inspection',
        })
        break
      }
    }
  }

  return matches
}

function buildSelector(el: Element): string {
  const tag = el.tagName.toLowerCase()
  if (el.id) return `${tag}#${el.id}`
  const name = el.getAttribute('name')
  if (name) return `${tag}[name="${name}"]`
  const cls = el.className?.toString?.().trim()
  if (cls) return `${tag}.${cls.split(/\s+/)[0]}`
  return tag
}

export function detectPII(text: string): PIIMatch[] {
  const matches: PIIMatch[] = []
  const seen = new Set<string>()

  for (const rule of REGEX_RULES) {
    const findings = rule.detect(text)
    for (const f of findings) {
      const key = `${rule.category}:${f.value}`
      if (seen.has(key)) continue
      seen.add(key)

      matches.push({
        type: rule.category,
        value: f.value,
        redacted: redact(f.value, rule.category),
        location: {
          source: 'dom',
          textOffset: { start: f.start, end: f.end },
        },
        confidence: f.confidence ?? rule.confidence,
        risk: rule.risk,
        action: rule.action,
        detectedBy: rule.detectedBy,
      })
    }
  }

  const domFindings = detectDOMFields(text)
  for (const df of domFindings) {
    const key = `${df.type}:${df.location.selector}`
    if (!seen.has(key)) {
      seen.add(key)
      matches.push(df)
    }
  }

  matches.sort((a, b) => {
    const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, none: 4 }
    return (riskOrder[a.risk] ?? 4) - (riskOrder[b.risk] ?? 4)
  })

  return matches
}

export function redactText(text: string, matches: PIIMatch[]): string {
  let result = text
  const textMatches = matches
    .filter((m) => m.location.textOffset)
    .sort((a, b) => (b.location.textOffset!.start) - (a.location.textOffset!.start))
  for (const m of textMatches) {
    const { start, end } = m.location.textOffset!
    result = result.slice(0, start) + m.redacted + result.slice(end)
  }
  return result
}
