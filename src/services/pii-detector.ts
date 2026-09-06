import type { PIIMatch } from '../types/scan'

const PII_PATTERNS: Record<string, RegExp> = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  credit_card: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
}

function redact(value: string, type: string): string {
  switch (type) {
    case 'email': {
      const [local, domain] = value.split('@')
      return `${local[0]}***@${domain}`
    }
    case 'phone':
      return value.replace(/\d(?=\d{4})/g, '*')
    case 'ssn':
      return `***-**-${value.slice(-4)}`
    case 'credit_card':
      return value.replace(/\d(?=\d{4})/g, '*')
    default:
      return '***'
  }
}

export function detectPII(text: string): PIIMatch[] {
  const matches: PIIMatch[] = []

  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    const regex = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        type: type as PIIMatch['type'],
        value: match[0],
        redacted: redact(match[0], type),
        location: {
          source: 'dom',
          textOffset: { start: match.index, end: match.index + match[0].length },
        },
        confidence: 0.9,
      })
    }
  }

  return matches
}

export function redactText(text: string, matches: PIIMatch[]): string {
  let result = text
  const sorted = [...matches].sort(
    (a, b) => (b.location.textOffset?.start ?? 0) - (a.location.textOffset?.start ?? 0)
  )
  for (const m of sorted) {
    if (m.location.textOffset) {
      result =
        result.slice(0, m.location.textOffset.start) +
        m.redacted +
        result.slice(m.location.textOffset.end)
    }
  }
  return result
}
