import type { ScanResult, SecurityFinding, SecurityReport } from '../types/scan'
import { aggregateFindings } from './findings'

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function generateSummary(findings: SecurityFinding[], level: string, score: number): string {
  if (findings.length === 0) {
    return 'No significant security findings were detected during this scan. The page appears safe for AI agent interaction.'
  }
  const critical = findings.filter(f => f.severity === 'critical').length
  const high = findings.filter(f => f.severity === 'high').length
  const medium = findings.filter(f => f.severity === 'medium').length
  const low = findings.filter(f => f.severity === 'low').length

  const parts: string[] = []
  parts.push(`Sentinel Lens detected ${findings.length} security finding${findings.length > 1 ? 's' : ''} with an overall risk score of ${score}/100 (${level.toUpperCase()}).`)
  const counts: string[] = []
  if (critical > 0) counts.push(`${critical} critical`)
  if (high > 0) counts.push(`${high} high`)
  if (medium > 0) counts.push(`${medium} medium`)
  if (low > 0) counts.push(`${low} low`)
  if (counts.length > 0) parts.push(`Severity breakdown: ${counts.join(', ')}.`)

  const categories = new Set(findings.map(f => f.category))
  if (categories.has('injection')) parts.push('Prompt injection attempts were detected — AI agent access should be restricted.')
  if (categories.has('privacy')) parts.push('Sensitive personal information is exposed on the page.')
  if (categories.has('deception')) parts.push('Hidden or deceptive content was found that could mislead AI agents.')

  return parts.join(' ')
}

export function generateReport(result: ScanResult, findings?: SecurityFinding[]): SecurityReport {
  const resolvedFindings = findings ?? aggregateFindings(result)
  const assessment = result.riskAssessment

  return {
    header: 'Sentinel Lens Security Report',
    scan: {
      url: result.url,
      hostname: extractHostname(result.url),
      timestamp: result.timestamp,
      id: result.id,
    },
    risk: {
      score: assessment?.score ?? 0,
      level: assessment?.level ?? 'none',
      confidence: assessment?.confidence ?? 1,
      categories: assessment?.categories ?? {
        privacy: { score: 0, level: 'none' },
        injection: { score: 0, level: 'none' },
        deception: { score: 0, level: 'none' },
        overall: { score: 0, level: 'none' },
      },
    },
    findings: resolvedFindings,
    summary: generateSummary(resolvedFindings, assessment?.level ?? 'none', assessment?.score ?? 0),
    generatedAt: Date.now(),
  }
}

export function serializeReport(report: SecurityReport): string {
  return JSON.stringify(report, null, 2)
}

export function downloadReport(report: SecurityReport): void {
  const json = serializeReport(report)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const ts = new Date(report.scan.timestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  a.href = url
  a.download = `sentinel-lens-report-${ts}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
