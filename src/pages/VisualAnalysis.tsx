import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { EyeIcon } from '../components/ui/Icons'
import { mockScanHistory } from '../data/mock'

export function VisualAnalysis() {
  const allHidden = mockScanHistory.flatMap((s) =>
    s.hiddenContent.map((h) => ({ ...h, url: s.url }))
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Panel title="Screenshot Comparison" subtitle="Upload a screenshot for DOM vs visual cross-validation">
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          minHeight: 200,
        }}
          className="visual-grid"
        >
          <div style={{
            border: '2px dashed var(--border)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            gap: 8,
            color: 'var(--text-muted)',
          }}>
            <EyeIcon size={32} />
            <p style={{ fontSize: 13, textAlign: 'center' }}>DOM Render</p>
            <p style={{ fontSize: 11, textAlign: 'center' }}>Visual representation of parsed DOM content</p>
          </div>
          <div style={{
            border: '2px dashed var(--border)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            gap: 8,
            color: 'var(--text-muted)',
          }}>
            <EyeIcon size={32} />
            <p style={{ fontSize: 13, textAlign: 'center' }}>Screenshot</p>
            <p style={{ fontSize: 11, textAlign: 'center' }}>Upload or capture a page screenshot</p>
          </div>
        </div>
      </Panel>

      <Panel title="Hidden Content Detection" subtitle={`${allHidden.length} hidden elements found`} noPadding>
        {allHidden.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', color: 'var(--text-muted)', gap: 8 }}>
            <EyeIcon size={36} />
            <p style={{ fontSize: 13 }}>No hidden content detected.</p>
          </div>
        ) : (
          <div>
            {allHidden.map((h, i) => (
              <div key={i} style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Badge variant="medium">{h.technique.replace(/_/g, ' ')}</Badge>
                  <code style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)' }}>&lt;{h.element}&gt;</code>
                  <code style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent-hover)' }}>{h.selector}</code>
                </div>
                <p style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  color: 'var(--yellow)',
                  background: 'var(--yellow-muted)',
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  wordBreak: 'break-word',
                }}>
                  {h.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Badge variant="info" dot>Coming Soon</Badge>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Visual overlay analysis will highlight detected elements directly on the screenshot with bounding boxes and annotations.
          </p>
        </div>
      </Card>
    </div>
  )
}
