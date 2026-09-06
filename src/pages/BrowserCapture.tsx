import { useState } from 'react'
import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { GlobeIcon, ShieldIcon, AlertIcon, EyeIcon, CheckCircleIcon } from '../components/ui/Icons'
import { scan } from '../services/scanner'
import type { ScanResult } from '../types/scan'
import type { PageId } from '../types/navigation'

interface BrowserCaptureProps {
  onScan: (result: ScanResult) => void
  onNavigate: (page: PageId) => void
}

export function BrowserCapture({ onScan, onNavigate }: BrowserCaptureProps) {
  const [url, setUrl] = useState('')
  const [html, setHtml] = useState('')
  const [scanning, setScanning] = useState(false)
  const [lastResult, setLastResult] = useState<ScanResult | null>(null)

  function handleAnalyze() {
    const content = html.trim()
    if (!content) return

    setScanning(true)
    setTimeout(() => {
      const result = scan({
        url: url.trim() || 'pasted-content',
        dom: content,
        screenshot: null,
      })
      setLastResult(result)
      onScan(result)
      setScanning(false)
    }, 300)
  }

  function handleClear() {
    setUrl('')
    setHtml('')
    setLastResult(null)
  }

  const hasContent = html.trim().length > 0

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
                value={url}
                onChange={(e) => setUrl(e.target.value)}
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
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
              Paste DOM / HTML content
            </label>
            <textarea
              placeholder="Paste HTML source here..."
              rows={10}
              value={html}
              onChange={(e) => setHtml(e.target.value)}
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
            <Button
              variant="primary"
              onClick={handleAnalyze}
              disabled={!hasContent || scanning}
            >
              {scanning ? 'Analyzing...' : 'Analyze Content'}
            </Button>
            {(hasContent || lastResult) && (
              <Button variant="secondary" onClick={handleClear}>Clear</Button>
            )}
          </div>
        </div>
      </Panel>

      {lastResult ? (
        <ResultPreview result={lastResult} onNavigate={onNavigate} />
      ) : (
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
      )}

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

function ResultPreview({ result, onNavigate }: { result: ScanResult; onNavigate: (page: PageId) => void }) {
  const riskColor = result.risk.overall === 'critical' ? 'var(--red)'
    : result.risk.overall === 'high' ? 'var(--orange)'
    : result.risk.overall === 'medium' ? 'var(--yellow)'
    : result.risk.overall === 'low' ? 'var(--green)'
    : 'var(--green)'

  return (
    <Panel title="Scan Results" subtitle={result.url}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderRadius: 'var(--radius)',
          background: `color-mix(in srgb, ${riskColor} 10%, var(--bg-input))`,
          border: `1px solid color-mix(in srgb, ${riskColor} 30%, transparent)`,
        }}>
          <Badge variant={result.risk.overall} dot>{result.risk.overall} risk</Badge>
          <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
            Overall risk assessment
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <FindingStat
            icon={<ShieldIcon size={16} />}
            label="PII Matches"
            count={result.piiMatches.length}
            color="var(--orange)"
            onClick={() => onNavigate('privacy-scanner')}
          />
          <FindingStat
            icon={<AlertIcon size={16} />}
            label="Injections"
            count={result.promptInjections.length}
            color="var(--red)"
            onClick={() => onNavigate('injection-scanner')}
          />
          <FindingStat
            icon={<EyeIcon size={16} />}
            label="Hidden Content"
            count={result.hiddenContent.length}
            color="var(--yellow)"
            onClick={() => onNavigate('visual-analysis')}
          />
        </div>

        {result.piiMatches.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.05em' }}>
              PII Found
            </p>
            {result.piiMatches.slice(0, 5).map((m, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 0',
                borderBottom: '1px solid var(--border)',
                fontSize: 12,
              }}>
                <Badge variant="high">{m.type.replace('_', ' ')}</Badge>
                <code style={{ fontFamily: 'var(--mono)', color: 'var(--red)', textDecoration: 'line-through' }}>{m.value}</code>
                <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                <code style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}>{m.redacted}</code>
              </div>
            ))}
            {result.piiMatches.length > 5 && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                +{result.piiMatches.length - 5} more...
              </p>
            )}
          </div>
        )}

        {result.promptInjections.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.05em' }}>
              Injections Detected
            </p>
            {result.promptInjections.slice(0, 3).map((inj, i) => (
              <div key={i} style={{
                padding: '6px 0',
                borderBottom: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Badge variant={inj.severity} dot>{inj.severity}</Badge>
                  <Badge variant="default">{inj.type}</Badge>
                </div>
                <code style={{
                  display: 'block',
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  color: 'var(--red)',
                  background: 'var(--red-muted)',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-sm)',
                  wordBreak: 'break-word',
                }}>
                  {inj.content.slice(0, 200)}
                </code>
              </div>
            ))}
          </div>
        )}

        {result.piiMatches.length === 0 && result.promptInjections.length === 0 && result.hiddenContent.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--green)', padding: '8px 0' }}>
            <CheckCircleIcon size={18} />
            <span style={{ fontSize: 13 }}>No threats detected. Content appears safe.</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={() => onNavigate('sanitized-context')}>
            View Sanitized Output
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onNavigate('security-report')}>
            Full Report
          </Button>
        </div>
      </div>
    </Panel>
  )
}

function FindingStat({
  icon,
  label,
  count,
  color,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  count: number
  color: string
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        background: 'var(--bg-input)',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-card-hover)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-input)'}
    >
      <div style={{ color }}>{icon}</div>
      <div>
        <p style={{ fontSize: 18, fontWeight: 700, color: count > 0 ? color : 'var(--text-muted)' }}>{count}</p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</p>
      </div>
    </div>
  )
}
