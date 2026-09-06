import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { AlertIcon } from '../components/ui/Icons'
import { mockScanHistory } from '../data/mock'

export function InjectionScanner() {
  const allInjections = mockScanHistory.flatMap((s) =>
    s.promptInjections.map((inj) => ({ ...inj, url: s.url, scanTime: s.timestamp }))
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {(['critical', 'high', 'medium', 'low'] as const).map((sev) => {
          const count = allInjections.filter((i) => i.severity === sev).length
          return (
            <Card key={sev}>
              <p style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.05em' }}>{sev}</p>
              <p style={{ fontSize: 24, fontWeight: 700, color: count > 0 ? `var(--${sev === 'critical' ? 'red' : sev === 'high' ? 'orange' : sev === 'medium' ? 'yellow' : 'green'})` : 'var(--text-muted)' }}>{count}</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>injections</p>
            </Card>
          )
        })}
      </div>

      <Panel title="Injection Findings" subtitle={`${allInjections.length} detected`} noPadding>
        {allInjections.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', color: 'var(--text-muted)', gap: 8 }}>
            <AlertIcon size={36} />
            <p style={{ fontSize: 13 }}>No prompt injections found.</p>
          </div>
        ) : (
          <div>
            {allInjections.map((inj, i) => (
              <div key={i} style={{
                padding: '12px 20px',
                borderBottom: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Badge variant={inj.severity} dot>{inj.severity}</Badge>
                  <Badge variant="default">{inj.type}</Badge>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{inj.url}</span>
                </div>
                <code style={{
                  display: 'block',
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  color: 'var(--red)',
                  background: 'var(--red-muted)',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  wordBreak: 'break-word',
                }}>
                  {inj.content}
                </code>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Detection Patterns">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { pattern: 'Ignore instructions', desc: 'Detects "ignore previous/prior instructions" variants', severity: 'critical' as const },
            { pattern: 'Role hijacking', desc: 'Detects "you are now" mode switching attempts', severity: 'critical' as const },
            { pattern: 'System prompt markers', desc: 'Detects [INST], <|im_start|>, system: markers', severity: 'high' as const },
            { pattern: 'Indirect manipulation', desc: 'Detects "pretend", "act as if" social engineering', severity: 'medium' as const },
            { pattern: 'Encoded payloads', desc: 'Base64/Unicode obfuscated injections', severity: 'medium' as const },
          ].map((p) => (
            <div key={p.pattern} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 0',
              borderBottom: '1px solid var(--border)',
              fontSize: 13,
            }}>
              <div>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{p.pattern}</span>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{p.desc}</p>
              </div>
              <Badge variant={p.severity}>{p.severity}</Badge>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
