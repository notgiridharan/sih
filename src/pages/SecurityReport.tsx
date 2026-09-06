import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { StatCard } from '../components/ui/StatCard'
import { ShieldIcon, AlertIcon, EyeIcon, CheckCircleIcon } from '../components/ui/Icons'
import { mockScanHistory } from '../data/mock'

export function SecurityReport() {
  const totalPii = mockScanHistory.reduce((n, s) => n + s.piiMatches.length, 0)
  const totalInj = mockScanHistory.reduce((n, s) => n + s.promptInjections.length, 0)
  const totalHidden = mockScanHistory.reduce((n, s) => n + s.hiddenContent.length, 0)
  const criticals = mockScanHistory.filter((s) => s.risk.overall === 'critical').length

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
        subtitle={`Generated from ${mockScanHistory.length} scans`}
        action={<Button variant="secondary" size="sm">Export PDF</Button>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mockScanHistory.map((scan) => (
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
      </Panel>

      <Panel title="Recommendations">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { severity: 'critical' as const, text: 'Block AI agent access to checkout.example.com until injection is resolved.' },
            { severity: 'high' as const, text: 'Enable automatic PII redaction for all form field contents.' },
            { severity: 'medium' as const, text: 'Review hidden content on news.example.com for potential manipulation.' },
            { severity: 'low' as const, text: 'Consider enabling screenshot analysis for visual-layer cross-validation.' },
          ].map((r, i) => (
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
