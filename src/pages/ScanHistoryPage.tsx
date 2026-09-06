import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { mockScanHistory } from '../data/mock'

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function ScanHistoryPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {mockScanHistory.length} scans recorded
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" size="sm">Export</Button>
          <Button variant="danger" size="sm">Clear History</Button>
        </div>
      </div>

      <Panel title="All Scans" noPadding>
        <div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '40px 1fr 100px 80px 80px 80px 80px',
            padding: '8px 20px',
            borderBottom: '1px solid var(--border)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            <span></span>
            <span>URL</span>
            <span>Risk</span>
            <span>PII</span>
            <span>Inject</span>
            <span>Hidden</span>
            <span>Time</span>
          </div>

          {mockScanHistory.map((scan, i) => (
            <div
              key={scan.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr 100px 80px 80px 80px 80px',
                padding: '12px 20px',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
                alignItems: 'center',
                cursor: 'pointer',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-card-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>#{i + 1}</span>
              <span style={{
                fontFamily: 'var(--mono)',
                fontSize: 12,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {scan.url}
              </span>
              <Badge variant={scan.risk.overall} dot>{scan.risk.overall}</Badge>
              <span style={{ color: scan.piiMatches.length > 0 ? 'var(--orange)' : 'var(--text-muted)' }}>
                {scan.piiMatches.length}
              </span>
              <span style={{ color: scan.promptInjections.length > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                {scan.promptInjections.length}
              </span>
              <span style={{ color: scan.hiddenContent.length > 0 ? 'var(--yellow)' : 'var(--text-muted)' }}>
                {scan.hiddenContent.length}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {timeAgo(scan.timestamp)}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
