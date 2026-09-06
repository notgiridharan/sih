import type { PromptInjection } from '../types/scan'

const INJECTION_PATTERNS: Array<{ pattern: RegExp; type: PromptInjection['type']; severity: PromptInjection['severity'] }> = [
  { pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi, type: 'direct', severity: 'critical' },
  { pattern: /you\s+are\s+now\s+(?:a|an|in)\s+\w+\s+mode/gi, type: 'direct', severity: 'critical' },
  { pattern: /disregard\s+(all\s+)?(previous|prior|above)/gi, type: 'direct', severity: 'critical' },
  { pattern: /forget\s+(all\s+)?(previous|prior|above)\s+(instructions?|context)/gi, type: 'direct', severity: 'critical' },
  { pattern: /system\s*:\s*.{10,}/gi, type: 'direct', severity: 'high' },
  { pattern: /\[INST\].*?\[\/INST\]/gis, type: 'direct', severity: 'high' },
  { pattern: /<\|im_start\|>system/gi, type: 'direct', severity: 'high' },
  { pattern: /do\s+not\s+(reveal|share|disclose|mention)\s+(your|the)\s+(instructions?|prompt|system)/gi, type: 'indirect', severity: 'medium' },
  { pattern: /pretend\s+(you\s+are|to\s+be|that)/gi, type: 'indirect', severity: 'medium' },
  { pattern: /act\s+as\s+(if|though|a)\s+/gi, type: 'indirect', severity: 'low' },
]

export function detectPromptInjections(text: string): PromptInjection[] {
  const results: PromptInjection[] = []

  for (const { pattern, type, severity } of INJECTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      results.push({
        type,
        content: match[0],
        location: {
          source: 'dom',
          textOffset: { start: match.index, end: match.index + match[0].length },
        },
        severity,
      })
    }
  }

  return results
}
