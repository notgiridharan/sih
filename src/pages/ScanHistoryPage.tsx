import { useState, useMemo } from 'react'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { mockScanHistory } from '../data/mock'
import { filterScans, extractHostname } from '../services/history'
import type { ScanResult, RiskLevel } from '../types/scan'
import type { PageId } from '../types/navigation'

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

const RISK_FILTERS: { label: string; value: RiskLevel | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Critical', value: 'critical' },
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
]

const TIME_FILTERS: { label: string; value: number | 0 }[] = [
  { label: 'All Time', value: 0 },
  { label: 'Today', value: 1 },
  { label: '7 Days', value: 7 },
  { label: '30 Days', value: 30 },
]

interface ScanHistoryPageProps {
  scanResults: ScanResult[]
  storedScans: ScanResult[]
  onClearHistory: () => void
  onDeleteScan: (id: string) => void
  onViewScan: (result: ScanResult) => void
  onNavigate: (page: PageId) => void
  storageError: string | null
}

export function ScanHistoryPage({
  scanResults,
  storedScans,
  onClearHistory,
  onDeleteScan,
  onViewScan,
  onNavigate,
  storageError,
}: ScanHistoryPageProps) {
  const [riskFilter, setRiskFilter] = useState<RiskLevel | 'all'>('all')
  const [timeFilter, setTimeFilter] = useState<number>(0)
  const [search, setSearch] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const allScans = storedScans.length > 0 ? storedScans : scanResults
  const isDemo = allScans.length === 0

  const filtered = useMemo(() => {
    const source = isDemo ? mockScanHistory : allScans
    return filterScans(source, {
      riskLevel: riskFilter === 'all' ? undefined : riskFilter,
      search: search.trim() || undefined,
      days: timeFilter || undefined,
    })
  }, [allScans, isDemo, riskFilter, timeFilter, search])

  const handleDelete = (id: string) => {
    if (deletingId === id) {
      onDeleteScan(id)
      setDeletingId(null)
    } else {
      setDeletingId(id)
    }
  }

  const handleClear = () => {
    if (confirmClear) {
      onClearHistory()
      setConfirmClear(false)
    } else {
      setConfirmClear(true)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header with counts and clear */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {filtered.length} scan{filtered.length !== 1 ? 's' : ''}
            {isDemo && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>(demo data)</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isDemo && (
            confirmClear ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Clear all scan history?</span>
                <Button variant="danger" size="sm" onClick={handleClear}>Confirm</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>Cancel</Button>
              </div>
            ) : (
              <Button variant="danger" size="sm" onClick={handleClear}>Clear History</Button>
            )
          )}
        </div>
      </div>

      {storageError && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--orange)' }}>
            <span style={{ fontSize: 13 }}>Storage warning: {storageError}</span>
          </div>
        </Card>
      )}

      {/* Search and Filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Search */}
        <input
          type="text"
          placeholder="Search scans by URL or hostname..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
            width: '100%',
          }}
        />

        {/* Filter row */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginRight: 4 }}>Risk</span>
            {RISK_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setRiskFilter(f.value)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid',
                  borderColor: riskFilter === f.value ? 'var(--accent)' : 'var(--border)',
                  background: riskFilter === f.value ? 'var(--accent-muted)' : 'transparent',
                  color: riskFilter === f.value ? 'var(--accent-hover)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  fontWeight: riskFilter === f.value ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginRight: 4 }}>Time</span>
            {TIME_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setTimeFilter(f.value)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid',
                  borderColor: timeFilter === f.value ? 'var(--accent)' : 'var(--border)',
                  background: timeFilter === f.value ? 'var(--accent-muted)' : 'transparent',
                  color: timeFilter === f.value ? 'var(--accent-hover)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  fontWeight: timeFilter === f.value ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Privacy indicator */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge variant="info" dot>Local Only</Badge>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Scan history is stored on this device. Nothing is uploaded to a server.
          </span>
        </div>
      </Card>

      {/* Results */}
      {filtered.length === 0 ? (
        <EmptyState hasScans={allScans.length > 0 || isDemo} search={search} onNavigate={onNavigate} />
      ) : (
        <Panel title="Scan History" noPadding>
          <div>
            {/* Header row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 90px 70px 60px 80px 50px',
              padding: '8px 20px',
              borderBottom: '1px solid var(--border)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              <span>Site</span>
              <span>Risk</span>
              <span>Score</span>
              <span>Findings</span>
              <span>Time</span>
              <span></span>
            </div>

            {filtered.map((scan) => {
              const host = extractHostname(scan.url)
              const score = scan.riskAssessment?.score ?? 0
              const level = scan.riskAssessment?.level ?? scan.risk.overall
              const findingCount = scan.findings?.length ?? (scan.piiMatches.length + scan.promptInjections.length + scan.hiddenContent.length)
              const isDeleting = deletingId === scan.id

              return (
                <div
                  key={scan.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 90px 70px 60px 80px 50px',
                    padding: '12px 20px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 13,
                    alignItems: 'center',
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                  }}
                  onClick={() => !isDemo && onViewScan(scan)}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; if (isDeleting) setDeletingId(null) }}
                >
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{
                      fontWeight: 500,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 13,
                    }}>
                      {host}
                    </div>
                    <div style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontFamily: 'var(--mono)',
                    }}>
                      {scan.url.replace(/^https?:\/\//, '')}
                    </div>
                  </div>

                  <Badge variant={level} dot>{level}</Badge>

                  <span style={{
                    fontWeight: 700,
                    fontSize: 14,
                    fontVariantNumeric: 'tabular-nums',
                    color: score >= 75 ? 'var(--red)' : score >= 50 ? 'var(--orange)' : score >= 25 ? 'var(--yellow)' : 'var(--green)',
                  }}>
                    {score}
                  </span>

                  <span style={{
                    fontSize: 12,
                    color: findingCount > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}>
                    {findingCount}
                  </span>

                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {timeAgo(scan.timestamp)}
                  </span>

                  <div onClick={(e) => e.stopPropagation()}>
                    {!isDemo && (
                      isDeleting ? (
                        <button
                          onClick={() => handleDelete(scan.id)}
                          style={{
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--red)',
                            background: 'var(--red-muted)',
                            color: 'var(--red)',
                            fontSize: 10,
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                          title="Confirm delete"
                        >
                          Confirm
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDelete(scan.id)}
                          style={{
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-sm)',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--text-muted)',
                            fontSize: 14,
                            cursor: 'pointer',
                            opacity: 0.5,
                            transition: 'opacity 0.1s',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                          onMouseLeave={(e) => e.currentTarget.style.opacity = '0.5'}
                          title="Delete scan"
                        >
                          &times;
                        </button>
                      )
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
      )}
    </div>
  )
}

function EmptyState({ hasScans, search, onNavigate }: { hasScans: boolean; search: string; onNavigate: (page: PageId) => void }) {
  return (
    <Card>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: '40px 20px',
        textAlign: 'center',
      }}>
        <span style={{ fontSize: 32, opacity: 0.3 }}>
          <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </span>
        {search ? (
          <>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>No matching scans found</p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Try a different search term.</p>
          </>
        ) : hasScans ? (
          <>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>No scans match the current filters</p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Try adjusting your filter settings.</p>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>No scans yet</p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Analyze a webpage to start building your local security history.
            </p>
            <Button variant="primary" size="sm" onClick={() => onNavigate('browser-capture')} style={{ marginTop: 8 }}>
              Start Scanning
            </Button>
          </>
        )}
      </div>
    </Card>
  )
}
