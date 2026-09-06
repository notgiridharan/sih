import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { GlobeIcon } from '../components/ui/Icons'

export function BrowserCapture() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Panel title="Capture Website" subtitle="Enter a URL or paste HTML to analyze">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
              Target URL
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="url"
                placeholder="https://example.com"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  fontFamily: 'var(--mono)',
                  outline: 'none',
                }}
              />
              <Button variant="primary">Capture</Button>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
              Or paste DOM / HTML content
            </label>
            <textarea
              placeholder="Paste HTML source here..."
              rows={10}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 13,
                fontFamily: 'var(--mono)',
                resize: 'vertical',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary">Analyze Content</Button>
            <Button variant="secondary">Upload Screenshot</Button>
          </div>
        </div>
      </Panel>

      <Panel title="Capture Preview" subtitle="No content captured yet">
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          color: 'var(--text-muted)',
          gap: 12,
        }}>
          <GlobeIcon size={40} />
          <p style={{ fontSize: 13, textAlign: 'center' }}>
            Enter a URL or paste HTML content above to begin analysis.
          </p>
        </div>
      </Panel>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Badge variant="info" dot>Info</Badge>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            All content is processed locally in your browser. No data is sent to external servers.
          </p>
        </div>
      </Card>
    </div>
  )
}
