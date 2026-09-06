import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { ShieldIcon } from '../components/ui/Icons'
import { mockScanHistory } from '../data/mock'
import type { ScanResult } from '../types/scan'

interface PrivacyScannerProps {
  scanResults: ScanResult[]
}

export function PrivacyScanner({ scanResults }: PrivacyScannerProps) {
  const data = scanResults.length > 0 ? scanResults : mockScanHistory
  const allPii = data.flatMap((s) =>
    s.piiMatches.map((m) => ({ ...m, url: s.url, scanTime: s.timestamp }))
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {(['email', 'phone', 'credit_card', 'ssn'] as const).map((type) => {
          const count = allPii.filter((m) => m.type === type).length
          return (
            <Card key={type}>
              <p style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.05em' }}>{type.replace('_', ' ')}</p>
              <p style={{ fontSize: 24, fontWeight: 700, color: count > 0 ? 'var(--orange)' : 'var(--green)' }}>{count}</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>detected instances</p>
            </Card>
          )
        })}
      </div>

      <Panel title="PII Findings" subtitle={`${allPii.length} items detected`} noPadding>
        {allPii.length === 0 ? (
          <EmptyState />
        ) : (
          <div>
            {allPii.map((m, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 20px',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
              }}>
                <Badge variant={m.confidence > 0.9 ? 'high' : 'medium'}>{m.type.replace('_', ' ')}</Badge>
                <code style={{
                  flex: 1,
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  color: 'var(--text-primary)',
                  background: 'var(--bg-input)',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}>
                  {m.value}
                </code>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--green)' }}>{m.redacted}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{(m.confidence * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Detection Rules">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { name: 'Email addresses', pattern: 'RFC 5322 regex', active: true },
            { name: 'Phone numbers', pattern: 'US/International formats', active: true },
            { name: 'Social Security Numbers', pattern: 'XXX-XX-XXXX', active: true },
            { name: 'Credit card numbers', pattern: 'Luhn-validated 16-digit', active: true },
            { name: 'Physical addresses', pattern: 'Address heuristics', active: false },
            { name: 'Names', pattern: 'NER-based detection', active: false },
          ].map((r) => (
            <div key={r.name} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 0',
              borderBottom: '1px solid var(--border)',
              fontSize: 13,
            }}>
              <div>
                <span style={{ color: 'var(--text-primary)' }}>{r.name}</span>
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>{r.pattern}</span>
              </div>
              <Badge variant={r.active ? 'none' : 'default'}>{r.active ? 'Active' : 'Planned'}</Badge>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', color: 'var(--text-muted)', gap: 8 }}>
      <ShieldIcon size={36} />
      <p style={{ fontSize: 13 }}>No PII detected. Run a scan to begin.</p>
    </div>
  )
}
