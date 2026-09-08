import { useState, useRef, useEffect, useCallback } from 'react'
import { Panel } from '../components/ui/Panel'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import {
  GlobeIcon,
  CameraIcon,
  CodeIcon,
  ImageIcon,
  CheckCircleIcon,
  ActivityIcon,
  AlertIcon,
  EyeIcon,
} from '../components/ui/Icons'
import { captureFromHTML, getMockCaptureData, getMockHTML } from '../services/capture'
import { scanWithOCR, cancelActiveScan } from '../services/scanner'
import { isExtension, captureActiveTab, captureScreenshot } from '../services/extension-bridge'
import type { ScanResult, CaptureData, CaptureStatus, DOMNodeInfo } from '../types/scan'
import type { PageId } from '../types/navigation'

interface BrowserCaptureProps {
  onScan: (result: ScanResult) => void
  onNavigate: (page: PageId) => void
  onCaptureDOM: (dom: string) => void
}

const STATUS_CONFIG: Record<CaptureStatus, { label: string; color: string; detail: string }> = {
  idle: { label: 'Ready', color: 'var(--text-muted)', detail: 'Enter a URL or paste HTML to begin' },
  capturing: { label: 'Capturing', color: 'var(--accent)', detail: 'Extracting DOM structure and rendering screenshot...' },
  captured: { label: 'Captured', color: 'var(--cyan)', detail: 'Content captured. Ready to analyze.' },
  analyzing: { label: 'Analyzing', color: 'var(--orange)', detail: 'Running privacy and injection scanners...' },
  complete: { label: 'Complete', color: 'var(--green)', detail: 'Analysis finished. View results below.' },
  error: { label: 'Error', color: 'var(--red)', detail: 'Capture failed. Please try again.' },
}

const WORKFLOW_STEPS: { key: CaptureStatus; label: string }[] = [
  { key: 'idle', label: 'Idle' },
  { key: 'capturing', label: 'Capturing' },
  { key: 'captured', label: 'Captured' },
  { key: 'analyzing', label: 'Analyzing' },
  { key: 'complete', label: 'Complete' },
]

function stepIndex(status: CaptureStatus): number {
  if (status === 'error') return -1
  return WORKFLOW_STEPS.findIndex((s) => s.key === status)
}

export function BrowserCapture({ onScan, onNavigate, onCaptureDOM }: BrowserCaptureProps) {
  const [url, setUrl] = useState('')
  const [html, setHtml] = useState('')
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [capture, setCapture] = useState<CaptureData | null>(null)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [inputMode, setInputMode] = useState<'url' | 'paste'>('url')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scanGenRef = useRef(0)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      cancelActiveScan()
    }
  }, [])

  const handleCapture = useCallback(() => {
    const content = inputMode === 'paste' ? html.trim() : ''
    const targetUrl = url.trim() || 'pasted-content'

    if (inputMode === 'url' && !url.trim() && !isExtension()) return
    if (inputMode === 'paste' && !content) return

    abortRef.current?.abort()
    cancelActiveScan()

    setStatus('capturing')
    setScanResult(null)
    setErrorMsg(null)

    if (inputMode === 'url' && isExtension()) {
      Promise.all([
        captureActiveTab(),
        captureScreenshot().catch(() => null),
      ])
        .then(([tabData, screenshotResult]) => {
          const captureData = captureFromHTML(tabData.url, tabData.dom)
          if (screenshotResult) {
            captureData.screenshot = screenshotResult.dataUrl
          }
          setCapture(captureData)
          setUrl(tabData.url)
          onCaptureDOM(captureData.dom)
          setStatus('captured')
        })
        .catch((err) => {
          if (!isExtension()) {
            const captureData = getMockCaptureData()
            setCapture(captureData)
            onCaptureDOM(captureData.dom)
            setStatus('captured')
          } else {
            setErrorMsg(err instanceof Error ? err.message : 'Capture failed. Check tab permissions.')
            setStatus('error')
          }
        })
    } else {
      setTimeout(() => {
        try {
          const captureData = inputMode === 'url'
            ? getMockCaptureData()
            : captureFromHTML(targetUrl, content)

          setCapture(captureData)
          onCaptureDOM(captureData.dom)
          setStatus('captured')
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to parse HTML content.')
          setStatus('error')
        }
      }, 1200)
    }
  }, [url, html, inputMode, onCaptureDOM])

  const handleAnalyze = useCallback(() => {
    if (!capture) return

    abortRef.current?.abort()
    cancelActiveScan()

    const controller = new AbortController()
    abortRef.current = controller
    const gen = ++scanGenRef.current

    setStatus('analyzing')
    setErrorMsg(null)

    scanWithOCR(
      { url: capture.url, dom: capture.dom, screenshot: capture.screenshot },
      undefined,
      controller.signal,
    ).then((result) => {
      if (scanGenRef.current !== gen || controller.signal.aborted) return
      setScanResult(result)
      onScan(result)
      setStatus('complete')
    }).catch((err) => {
      if (scanGenRef.current !== gen || controller.signal.aborted) return
      setErrorMsg(err instanceof Error ? err.message : 'Analysis failed unexpectedly.')
      setStatus('error')
    })
  }, [capture, onScan])

  const handleUseMock = useCallback(() => {
    setUrl('https://securebank.com/dashboard')
    setHtml(getMockHTML())
    setInputMode('paste')
  }, [])

  const handleReset = useCallback(() => {
    abortRef.current?.abort()
    cancelActiveScan()
    setUrl('')
    setHtml('')
    setStatus('idle')
    setCapture(null)
    setScanResult(null)
    setErrorMsg(null)
  }, [])

  const isCapturing = status === 'capturing'
  const isAnalyzing = status === 'analyzing'
  const isBusy = isCapturing || isAnalyzing

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      {/* Workflow Progress */}
      <WorkflowProgress status={status} />

      {/* Error display */}
      {errorMsg && (
        <div role="alert" style={{
          padding: '12px 16px',
          background: 'var(--red-muted)',
          border: '1px solid var(--red)',
          borderRadius: 'var(--radius)',
          color: 'var(--red)',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <span>{errorMsg}</span>
          <Button variant="ghost" size="sm" onClick={handleReset} aria-label="Dismiss error and reset">
            Try Again
          </Button>
        </div>
      )}

      {/* Input Panel */}
      <Panel
        title="Capture Website"
        subtitle={STATUS_CONFIG[status].detail}
        action={
          status !== 'idle' && (
            <Button variant="ghost" size="sm" onClick={handleReset} disabled={isBusy}>
              New Capture
            </Button>
          )
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Input mode tabs */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-input)', borderRadius: 'var(--radius)', padding: 3 }}>
            <TabButton
              active={inputMode === 'url'}
              onClick={() => setInputMode('url')}
              disabled={status !== 'idle'}
            >
              <GlobeIcon size={14} /> URL Capture
            </TabButton>
            <TabButton
              active={inputMode === 'paste'}
              onClick={() => setInputMode('paste')}
              disabled={status !== 'idle'}
            >
              <CodeIcon size={14} /> Paste HTML
            </TabButton>
          </div>

          {inputMode === 'url' ? (
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
                  disabled={status !== 'idle'}
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
                    opacity: status !== 'idle' ? 0.6 : 1,
                  }}
                />
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                {isExtension()
                  ? 'Captures the DOM of the currently active browser tab.'
                  : 'URL capture uses mock data in this environment. Load as a Chrome extension for real tab capture.'}
              </p>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
                  Paste DOM / HTML Content
                </label>
                {status === 'idle' && (
                  <Button variant="ghost" size="sm" onClick={handleUseMock}>
                    Load Demo Page
                  </Button>
                )}
              </div>
              <textarea
                placeholder="Paste HTML source here..."
                rows={8}
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                disabled={status !== 'idle'}
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
                  opacity: status !== 'idle' ? 0.6 : 1,
                }}
              />
              {inputMode === 'paste' && status === 'idle' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
                    Source URL (optional)
                  </label>
                  <input
                    type="url"
                    placeholder="https://example.com"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '5px 10px',
                      borderRadius: 'var(--radius)',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                      fontFamily: 'var(--mono)',
                      outline: 'none',
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            {status === 'idle' && (
              <Button
                variant="primary"
                onClick={handleCapture}
                disabled={inputMode === 'url' ? (!url.trim() && !isExtension()) : !html.trim()}
                icon={<CameraIcon size={14} />}
                aria-label={inputMode === 'url' && isExtension() ? 'Capture active browser tab' : 'Capture HTML content'}
              >
                {inputMode === 'url' && isExtension() ? 'Capture Active Tab' : 'Capture'}
              </Button>
            )}
            {status === 'captured' && (
              <Button
                variant="primary"
                onClick={handleAnalyze}
                icon={<ActivityIcon size={14} />}
                aria-label="Run security analysis on captured content"
              >
                Analyze Content
              </Button>
            )}
            {status === 'complete' && scanResult && (
              <>
                <Button variant="primary" size="sm" onClick={() => onNavigate('privacy-scanner')}>
                  View Privacy Scan
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onNavigate('injection-scanner')}>
                  View Injections
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onNavigate('sanitized-context')}>
                  Sanitized Output
                </Button>
              </>
            )}
          </div>
        </div>
      </Panel>

      {/* Capture Outputs — Two panels */}
      {status !== 'idle' && (
        <div className="capture-grid" style={{ animation: 'fade-in 0.3s ease' }}>
          <ScreenshotPanel capture={capture} status={status} />
          <DOMStructurePanel capture={capture} status={status} />
        </div>
      )}

      {/* Capture metadata */}
      {capture && status !== 'capturing' && (
        <CaptureMetadataPanel capture={capture} />
      )}

      {/* Analysis summary */}
      {status === 'complete' && scanResult && (
        <AnalysisSummary result={scanResult} />
      )}

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Badge variant="info" dot>Local Processing</Badge>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            All content is captured and analyzed locally in your browser. No data is sent to external servers.
          </p>
        </div>
      </Card>
    </div>
  )
}

/* ─── Workflow Progress ─────────────────────────────────────────── */

function WorkflowProgress({ status }: { status: CaptureStatus }) {
  const current = stepIndex(status)

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      padding: 'var(--space-md) var(--space-lg)',
      background: 'var(--bg-card)',
      borderRadius: 'var(--radius-lg)',
    }}>
      {WORKFLOW_STEPS.map((step, i) => {
        const isActive = i === current
        const isDone = i < current
        const isError = status === 'error' && i === 0

        let dotColor = 'var(--border-light)'
        let dotBg = 'transparent'
        let textColor = 'var(--text-muted)'

        if (isActive) {
          dotColor = STATUS_CONFIG[status].color
          dotBg = STATUS_CONFIG[status].color
          textColor = 'var(--text-primary)'
        } else if (isDone) {
          dotColor = 'var(--green)'
          dotBg = 'var(--green)'
          textColor = 'var(--text-secondary)'
        } else if (isError) {
          dotColor = 'var(--red)'
          dotBg = 'var(--red)'
          textColor = 'var(--red)'
        }

        return (
          <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: i < WORKFLOW_STEPS.length - 1 ? 1 : '0 0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
              <div style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: `2px solid ${dotColor}`,
                background: isDone || isActive ? dotBg : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.3s ease',
                position: 'relative',
              }}>
                {isDone && (
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {isActive && (status === 'capturing' || status === 'analyzing') && (
                  <span style={{
                    position: 'absolute',
                    inset: -4,
                    borderRadius: '50%',
                    border: `2px solid ${dotColor}`,
                    opacity: 0.4,
                    animation: 'pulse-ring 2s ease-out infinite',
                  }} />
                )}
                {isActive && !(status === 'capturing' || status === 'analyzing') && (
                  <div style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#fff',
                  }} />
                )}
              </div>
              <span style={{
                fontSize: 12,
                fontWeight: isActive ? 500 : 400,
                color: textColor,
                whiteSpace: 'nowrap',
              }}>
                {step.label}
              </span>
            </div>
            {i < WORKFLOW_STEPS.length - 1 && (
              <div style={{
                flex: 1,
                height: 2,
                margin: '0 12px',
                background: isDone ? 'var(--green)' : 'var(--border)',
                borderRadius: 1,
                transition: 'background 0.3s ease',
                minWidth: 20,
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ─── Tab Button ───────────────────────────────────────────────── */

function TabButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '7px 12px',
        borderRadius: 'var(--radius-sm)',
        border: 'none',
        background: active ? 'var(--bg-card)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'all 0.15s',
        boxShadow: active ? 'var(--shadow-sm)' : 'none',
      }}
    >
      {children}
    </button>
  )
}

/* ─── Screenshot Panel ─────────────────────────────────────────── */

function ScreenshotPanel({ capture, status }: { capture: CaptureData | null; status: CaptureStatus }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const isLoading = status === 'capturing'
  const hasRealScreenshot = capture?.screenshot != null

  useEffect(() => {
    if (capture && !hasRealScreenshot && iframeRef.current) {
      const doc = iframeRef.current.contentDocument
      if (doc) {
        doc.open()
        doc.write(capture.dom)
        doc.close()
      }
    }
  }, [capture, hasRealScreenshot])

  return (
    <Panel
      title="Website Screenshot"
      subtitle={capture ? capture.url : 'Waiting for capture...'}
      action={
        <Badge variant={capture ? 'none' : 'default'}>
          <ImageIcon size={12} /> {hasRealScreenshot ? 'Live Capture' : capture ? 'DOM Render' : 'Pending'}
        </Badge>
      }
    >
      <div style={{
        position: 'relative',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        background: '#fff',
        minHeight: 280,
      }}>
        {isLoading ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 280,
            background: 'var(--bg-input)',
            gap: 12,
          }}>
            <CameraIcon size={32} />
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Capturing screenshot...</p>
            <div style={{
              width: 120,
              height: 3,
              borderRadius: 2,
              background: 'var(--border)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: '60%',
                height: '100%',
                background: 'var(--accent)',
                borderRadius: 2,
                animation: 'pulse-ring 1.5s ease infinite',
              }} />
            </div>
          </div>
        ) : capture ? (
          <>
            {/* Browser chrome */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              background: '#e8eaed',
              borderBottom: '1px solid #d0d0d0',
            }}>
              <div style={{ display: 'flex', gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f56' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#27c93f' }} />
              </div>
              <div style={{
                flex: 1,
                padding: '3px 10px',
                borderRadius: 4,
                background: '#fff',
                fontSize: 11,
                color: '#555',
                fontFamily: 'var(--mono)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {capture.url}
              </div>
              {hasRealScreenshot && (
                <span style={{
                  fontSize: 10,
                  color: 'var(--green)',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  Live
                </span>
              )}
            </div>
            {/* Real screenshot or DOM-rendered fallback */}
            {hasRealScreenshot ? (
              <img
                src={capture.screenshot!}
                alt="Captured screenshot of the active tab"
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight: 480,
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            ) : (
              <iframe
                ref={iframeRef}
                sandbox="allow-same-origin"
                title="Screenshot preview"
                style={{
                  width: '100%',
                  height: 320,
                  border: 'none',
                  display: 'block',
                  pointerEvents: 'none',
                }}
              />
            )}
            {/* Scan line overlay during analyzing */}
            {status === 'analyzing' && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                pointerEvents: 'none',
              }}>
                <div style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  height: 2,
                  background: `linear-gradient(90deg, transparent, var(--accent), transparent)`,
                  animation: 'scan-line 2s ease-in-out infinite',
                  boxShadow: '0 0 8px var(--accent)',
                }} />
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(99, 102, 241, 0.05)',
                }} />
              </div>
            )}
          </>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 280,
            background: 'var(--bg-input)',
            gap: 8,
            color: 'var(--text-muted)',
          }}>
            <ImageIcon size={36} />
            <p style={{ fontSize: 13 }}>Screenshot will appear here</p>
          </div>
        )}
      </div>
    </Panel>
  )
}

/* ─── DOM Structure Panel ──────────────────────────────────────── */

function DOMStructurePanel({ capture, status }: { capture: CaptureData | null; status: CaptureStatus }) {
  const isLoading = status === 'capturing'

  return (
    <Panel
      title="DOM Structure"
      subtitle={capture ? `${capture.metadata.elementCount} elements` : 'Waiting for capture...'}
      action={<Badge variant={capture ? 'none' : 'default'}><CodeIcon size={12} /> {capture ? 'Parsed' : 'Pending'}</Badge>}
    >
      <div style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        background: 'var(--bg-input)',
        minHeight: 280,
      }}>
        {isLoading ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 280,
            gap: 12,
            color: 'var(--text-muted)',
          }}>
            <CodeIcon size={32} />
            <p style={{ fontSize: 13 }}>Parsing DOM structure...</p>
            <div style={{
              width: 120,
              height: 3,
              borderRadius: 2,
              background: 'var(--border)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: '45%',
                height: '100%',
                background: 'var(--cyan)',
                borderRadius: 2,
                animation: 'pulse-ring 1.5s ease infinite',
              }} />
            </div>
          </div>
        ) : capture ? (
          <div style={{
            maxHeight: 370,
            overflow: 'auto',
            padding: '12px 0',
          }}>
            <DOMTreeView node={capture.domTree} />
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: 280,
            gap: 8,
            color: 'var(--text-muted)',
          }}>
            <CodeIcon size={36} />
            <p style={{ fontSize: 13 }}>DOM tree will appear here</p>
          </div>
        )}
      </div>
    </Panel>
  )
}

/* ─── DOM Tree View ────────────────────────────────────────────── */

function DOMTreeView({ node }: { node: DOMNodeInfo }) {
  const [expanded, setExpanded] = useState(node.depth < 2)
  const hasChildren = node.children.length > 0
  const indent = node.depth * 16

  const tagColor = node.hidden ? 'var(--red)' : 'var(--cyan)'
  const attrColor = 'var(--yellow)'
  const valColor = 'var(--green)'

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 12px 2px',
          paddingLeft: 12 + indent,
          cursor: hasChildren ? 'pointer' : 'default',
          fontSize: 12,
          fontFamily: 'var(--mono)',
          lineHeight: 1.8,
          transition: 'background 0.1s',
        }}
        onClick={() => hasChildren && setExpanded(!expanded)}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-card-hover)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        {/* Expand arrow */}
        {hasChildren ? (
          <span style={{
            color: 'var(--text-muted)',
            fontSize: 10,
            width: 12,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.15s',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}>
            &#9654;
          </span>
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}

        {/* Tag */}
        <span style={{ color: 'var(--text-muted)' }}>&lt;</span>
        <span style={{ color: tagColor, fontWeight: 600 }}>{node.tag}</span>

        {/* id */}
        {node.id && (
          <>
            <span style={{ color: attrColor }}> id</span>
            <span style={{ color: 'var(--text-muted)' }}>=</span>
            <span style={{ color: valColor }}>"{node.id}"</span>
          </>
        )}

        {/* classes */}
        {node.classes && node.classes.length > 0 && (
          <>
            <span style={{ color: attrColor }}> class</span>
            <span style={{ color: 'var(--text-muted)' }}>=</span>
            <span style={{ color: valColor }}>"{node.classes.join(' ')}"</span>
          </>
        )}

        {/* key attributes */}
        {Object.entries(node.attributes).slice(0, 3).map(([k, v]) => (
          <span key={k}>
            <span style={{ color: attrColor }}> {k}</span>
            {v && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>=</span>
                <span style={{ color: valColor }}>"{v}"</span>
              </>
            )}
          </span>
        ))}

        <span style={{ color: 'var(--text-muted)' }}>&gt;</span>

        {/* Badges */}
        {node.hidden && (
          <span style={{
            marginLeft: 6,
            fontSize: 9,
            padding: '1px 5px',
            borderRadius: 3,
            background: 'var(--red-muted)',
            color: 'var(--red)',
            fontWeight: 700,
            fontFamily: 'var(--sans)',
          }}>
            HIDDEN
          </span>
        )}
        {node.childCount > 0 && !expanded && (
          <span style={{
            marginLeft: 4,
            fontSize: 10,
            color: 'var(--text-muted)',
            fontFamily: 'var(--sans)',
          }}>
            {node.childCount} children
          </span>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children.map((child, i) => (
            <DOMTreeView key={`${child.tag}-${i}`} node={child} />
          ))}
          {node.childCount > node.children.length && (
            <div style={{
              paddingLeft: 12 + indent + 28,
              fontSize: 11,
              color: 'var(--text-muted)',
              fontFamily: 'var(--mono)',
              lineHeight: 1.8,
            }}>
              ... {node.childCount - node.children.length} more elements
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Capture Metadata ─────────────────────────────────────────── */

function CaptureMetadataPanel({ capture }: { capture: CaptureData }) {
  const m = capture.metadata
  const stats = [
    { label: 'Elements', value: m.elementCount, color: 'var(--cyan)' },
    { label: 'Text Nodes', value: m.textNodeCount, color: 'var(--text-secondary)' },
    { label: 'Forms', value: m.formCount, color: m.formCount > 0 ? 'var(--orange)' : 'var(--text-muted)' },
    { label: 'Inputs', value: m.inputCount, color: m.inputCount > 0 ? 'var(--orange)' : 'var(--text-muted)' },
    { label: 'Scripts', value: m.scriptCount, color: m.scriptCount > 0 ? 'var(--yellow)' : 'var(--text-muted)' },
    { label: 'Links', value: m.linkCount, color: 'var(--text-secondary)' },
    { label: 'Images', value: m.imageCount, color: 'var(--text-secondary)' },
    { label: 'iFrames', value: m.iframeCount, color: m.iframeCount > 0 ? 'var(--red)' : 'var(--text-muted)' },
    { label: 'Hidden', value: m.hiddenElementCount, color: m.hiddenElementCount > 0 ? 'var(--red)' : 'var(--text-muted)' },
    { label: 'Text Size', value: `${(m.totalTextLength / 1024).toFixed(1)}KB`, color: 'var(--text-secondary)' },
  ]

  return (
    <Panel title="Capture Metadata" subtitle={`${m.title} — ${capture.dom.length.toLocaleString()} bytes`}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
        gap: 10,
      }}>
        {stats.map((s) => (
          <div key={s.label} style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: '8px 10px',
            background: 'var(--bg-input)',
            borderRadius: 'var(--radius-sm)',
          }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 500, fontFamily: 'var(--font-body)' }}>
              {s.label}
            </span>
            <span style={{ fontSize: 20, fontFamily: 'var(--font-display)', fontWeight: 300, color: s.color, fontVariantNumeric: 'tabular-nums' }}>
              {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ─── Analysis Summary ─────────────────────────────────────────── */

function AnalysisSummary({ result }: { result: ScanResult }) {
  const riskColor = result.risk.overall === 'critical' ? 'var(--red)'
    : result.risk.overall === 'high' ? 'var(--orange)'
    : result.risk.overall === 'medium' ? 'var(--yellow)'
    : 'var(--green)'

  return (
    <Panel title="Analysis Results" subtitle={`Scan completed at ${new Date(result.timestamp).toLocaleTimeString()}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px',
          borderRadius: 'var(--radius)',
          background: `color-mix(in srgb, ${riskColor} 8%, var(--bg-input))`,
          border: `1px solid color-mix(in srgb, ${riskColor} 25%, transparent)`,
        }}>
          <Badge variant={result.risk.overall} dot>{result.risk.overall} risk</Badge>
          <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>
            Overall risk assessment for {result.url}
          </span>
          <CheckCircleIcon size={18} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <SummaryCard
            icon={<AlertIcon size={18} />}
            label="PII Matches"
            count={result.piiMatches.length}
            score={result.risk.privacy}
            color="var(--orange)"
          />
          <SummaryCard
            icon={<AlertIcon size={18} />}
            label="Injections"
            count={result.promptInjections.length}
            score={result.risk.injection}
            color="var(--red)"
          />
          <SummaryCard
            icon={<AlertIcon size={18} />}
            label="Hidden Content"
            count={result.hiddenContent.length}
            score={result.risk.hidden}
            color="var(--yellow)"
          />
          <SummaryCard
            icon={<EyeIcon size={18} />}
            label="DOM/Visual Anomaly"
            count={result.crossValidation?.anomalies.length ?? 0}
            score={result.risk.visualAnomaly}
            color="var(--cyan)"
          />
        </div>
      </div>
    </Panel>
  )
}

function SummaryCard({
  icon,
  label,
  count,
  score,
  color,
}: {
  icon: React.ReactNode
  label: string
  count: number
  score: number
  color: string
}) {
  return (
    <div style={{
      padding: '12px 14px',
      background: 'var(--bg-input)',
      borderRadius: 'var(--radius)',
      borderLeft: `3px solid ${count > 0 ? color : 'var(--border)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: count > 0 ? color : 'var(--text-muted)' }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-body)' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 28, fontFamily: 'var(--font-display)', fontWeight: 300, color: count > 0 ? color : 'var(--text-muted)' }}>
          {count}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>found</span>
      </div>
      <div style={{
        marginTop: 8,
        height: 3,
        borderRadius: 2,
        background: 'var(--border)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${Math.min(score, 100)}%`,
          background: color,
          borderRadius: 2,
          transition: 'width 0.5s ease',
        }} />
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
        Risk score: {score}/100
      </span>
    </div>
  )
}
