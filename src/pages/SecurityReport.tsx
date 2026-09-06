import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { StatCard } from '../components/ui/StatCard'
import { ShieldIcon, AlertIcon, EyeIcon, CheckCircleIcon } from '../components/ui/Icons'
import { mockScanHistory } from '../data/mock'
import type { ScanResult } from '../types/scan'

interface SecurityReportProps {
  scanResults: ScanResult[]
}

export function SecurityReport({ scanResults }: SecurityReportProps) {
  const data = scanResults.length > 0 ? scanResults : mockScanHistory
  const totalPii = data.reduce((n, s) => n + s.piiMatches.length, 0)
  const totalInj = data.reduce((n, s) => n + s.promptInjections.length, 0)
  const totalHidden = data.reduce((n, s) => n + s.hiddenContent.length, 0)
  const criticals = data.filter((s) => s.risk.overall === 'critical').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <StatCard label="PII Findings" value={totalPii} icon={<ShieldIcon size={20} />} color="var(--orange)" />
        <StatCard label="Injections" value={totalInj} icon={<AlertIcon size={20} />} color="var(--red)" />
        <StatCard label="Hidden Content" value={totalHidden} icon={<EyeIcon size={20} />} color="var(--yellow)" />
        <StatCard label="Critical Scans" value={criticals} icon={<CheckCircleIcon size={20} />} color="var(--red)" />
      </div>

      <Panel
        title="Security Summary"
        subtitle={`Generated from ${data.length} scans`}
        action={<Button variant="secondary" size="sm">Export PDF</Button>}
      >
        {data.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>
            No scans recorded. Run a scan from Browser Capture to generate a report.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data.map((scan) => (
              <div key={scan.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                background: 'var(--bg-input)',
                borderRadius: 'var(--radius)',
                fontSize: 13,
              }}>
                <Badge variant={scan.risk.overall} dot>{scan.risk.overall}</Badge>
                <span style={{ flex: 1, color: 'var(--text-primary)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                  {scan.url}
                </span>
                <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)' }}>
                  <span>{scan.piiMatches.length} PII</span>
                  <span>{scan.promptInjections.length} Inj</span>
                  <span>{scan.hiddenContent.length} Hidden</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Recommendations">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {generateRecommendations(data).map((r, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '8px 0',
              borderBottom: '1px solid var(--border)',
              fontSize: 13,
            }}>
              <Badge variant={r.severity}>{r.severity}</Badge>
              <span style={{ color: 'var(--text-primary)' }}>{r.text}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function generateRecommendations(data: ScanResult[]) {
  const recs: { severity: 'critical' | 'high' | 'medium' | 'low'; text: string }[] = []

  const hasCriticalInj = data.some((s) => s.promptInjections.some((i) => i.severity === 'critical'))
  const hasPii = data.some((s) => s.piiMatches.length > 0)
  const hasHidden = data.some((s) => s.hiddenContent.length > 0)
  const hasClean = data.some((s) => s.risk.overall === 'none')

  if (hasCriticalInj) {
    recs.push({ severity: 'critical', text: 'Critical prompt injections detected. Block AI agent access to affected pages until resolved.' })
  }
  if (hasPii) {
    recs.push({ severity: 'high', text: 'Enable automatic PII redaction for all form field contents before sharing with AI agents.' })
  }
  if (hasHidden) {
    recs.push({ severity: 'medium', text: 'Review hidden content elements for potential manipulation or concealed instructions.' })
  }
  recs.push({ severity: 'low', text: 'Consider enabling screenshot analysis for visual-layer cross-validation.' })
  if (hasClean) {
    recs.push({ severity: 'low', text: 'Some pages are clean — consider whitelisting them for faster agent processing.' })
  }

  if (recs.length === 1) {
    recs.unshift({ severity: 'low', text: 'No significant threats detected. Continue monitoring with regular scans.' })
  }

  return recs
}
