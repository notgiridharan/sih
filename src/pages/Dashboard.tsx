import { useState, useMemo } from 'react'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import {
  ShieldIcon,
  AlertIcon,
  EyeIcon,
  LockIcon,
  GlobeIcon,
  CameraIcon,
  CodeIcon,
  ImageIcon,
  FilterIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
} from '../components/ui/Icons'
import {
  mockMetrics,
  mockPipeline,
  mockRecentScans,
} from '../data/mock'
import { computeStats, computeTrend, mostScannedDomains, highestRiskDomains } from '../services/history'
import type { PageId } from '../types/navigation'
import type { PipelineStatus, ScanStatus, RecentScan } from '../data/mock'
import type { RiskLevel, ScanResult } from '../types/scan'

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

interface DashboardProps {
  onNavigate: (page: PageId) => void
  scanResults: ScanResult[]
  storedScans: ScanResult[]
}

function computeMetrics(results: ScanResult[]) {
  if (results.length === 0) return mockMetrics
  const maxPrivacy = Math.max(...results.map((r) => r.risk.privacy))
  const maxInjection = Math.max(...results.map((r) => r.risk.injection))
  const totalPii = results.reduce((n, s) => n + s.piiMatches.length, 0)
  const totalInj = results.reduce((n, s) => n + s.promptInjections.length, 0)
  return {
    privacyRiskScore: maxPrivacy,
    injectionRiskScore: maxInjection,
    sensitiveElements: totalPii,
    suspiciousInstructions: totalInj,
    pagesScanned: results.length,
  }
}

export function Dashboard({ onNavigate, scanResults, storedScans }: DashboardProps) {
  const allScans = storedScans.length > 0 ? storedScans : scanResults
  const metrics = computeMetrics(allScans)
  const stats = useMemo(() => computeStats(allScans), [allScans])
  const trend = useMemo(() => computeTrend(allScans), [allScans])
  const topDomains = useMemo(() => mostScannedDomains(allScans, 5), [allScans])
  const riskyDomains = useMemo(() => highestRiskDomains(allScans, 5), [allScans])
  const hasRealData = allScans.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      <MetricCards metrics={metrics} />

      {hasRealData && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--space-md)',
        }} className="dashboard-grid-4">
          <StatTile label="Total Scans" value={stats.totalScans} color="var(--cyan)" />
          <StatTile label="Scans Today" value={stats.scansToday} color="var(--accent)" />
          <StatTile label="Average Risk" value={stats.averageRisk} suffix="/100" color={stats.averageRisk >= 50 ? 'var(--orange)' : 'var(--green)'} />
          <StatTile label="High-Risk Domains" value={stats.highRiskDomains} color="var(--red)" />
        </div>
      )}

      {hasRealData && stats.totalScans > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 'var(--space-md)',
        }} className="dashboard-grid-5">
          <StatTile label="Critical" value={stats.criticalCount} color="var(--red)" />
          <StatTile label="High" value={stats.highCount} color="var(--orange)" />
          <StatTile label="Medium" value={stats.mediumCount} color="var(--yellow)" />
          <StatTile label="Low" value={stats.lowCount} color="var(--green)" />
          <StatTile label="Clean" value={stats.noneCount} color="var(--text-muted)" />
        </div>
      )}

      {hasRealData && trend.length >= 2 && (
        <Panel title="Risk Trend" subtitle={`Last ${trend.length} days`}>
          <TrendChart data={trend} />
        </Panel>
      )}
      {hasRealData && trend.length < 2 && (
        <Panel title="Risk Trend">
          <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            Not enough scan history to calculate trends.
          </p>
        </Panel>
      )}

      {hasRealData && topDomains.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }} className="dashboard-grid-2">
          <Panel title="Most Scanned" noPadding>
            <div>
              {topDomains.map((d, i) => (
                <div key={d.hostname} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px var(--space-lg)',
                  borderBottom: i < topDomains.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <span style={{ fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--text-primary)' }}>{d.hostname}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{d.scanCount}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Highest Risk" noPadding>
            <div>
              {riskyDomains.map((d, i) => (
                <div key={d.hostname} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px var(--space-lg)',
                  borderBottom: i < riskyDomains.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <span style={{ fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--text-primary)' }}>{d.hostname}</span>
                  <span style={{
                    fontSize: 13,
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    color: d.highestScore >= 75 ? 'var(--red)' : d.highestScore >= 50 ? 'var(--orange)' : d.highestScore >= 25 ? 'var(--yellow)' : 'var(--green)',
                  }}>
                    {d.highestScore}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      <AnalysisPipeline />
      <RecentScansTable onNavigate={onNavigate} scanResults={allScans} />
    </div>
  )
}

/* ─── Stat Tile ─────────────────────────────────────────────────── */

function StatTile({ label, value, suffix, color }: { label: string; value: number; suffix?: string; color: string }) {
  return (
    <div style={{
      padding: 'var(--space-lg)',
      background: 'var(--bg-card)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <span style={{
        fontSize: 13,
        fontWeight: 400,
        color: 'var(--text-muted)',
        display: 'block',
        marginBottom: 8,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 32,
        fontWeight: 300,
        fontFamily: 'var(--font-display)',
        color,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}{suffix && <span style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>{suffix}</span>}
      </span>
    </div>
  )
}

/* ─── Trend Chart ──────────────────────────────────────────────── */

function TrendChart({ data }: { data: { date: string; avgScore: number; scanCount: number }[] }) {
  const max = Math.max(...data.map(d => d.avgScore), 10)
  const height = 140
  const barWidth = Math.max(12, Math.min(40, 600 / data.length - 8))

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height, padding: '0 4px', minWidth: data.length * (barWidth + 6) }}>
        {data.map((d) => {
          const pct = (d.avgScore / max) * 100
          const color = d.avgScore >= 75 ? 'var(--red)' : d.avgScore >= 50 ? 'var(--orange)' : d.avgScore >= 25 ? 'var(--yellow)' : 'var(--green)'
          const dateLabel = d.date.slice(5)

          return (
            <div key={d.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: '0 0 auto' }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{d.avgScore}</span>
              <div style={{
                width: barWidth,
                height: `${Math.max(pct, 2)}%`,
                borderRadius: 'var(--radius-sm)',
                background: color,
                opacity: 0.7,
                transition: 'height 0.4s ease',
                minHeight: 4,
              }} />
              <span style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{dateLabel}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Metric Cards ──────────────────────────────────────────────── */

function MetricCards({ metrics }: { metrics: ReturnType<typeof computeMetrics> }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(5, 1fr)',
      gap: 'var(--space-md)',
    }}
      className="dashboard-grid-5"
    >
      <MetricCard
        label="Privacy Risk"
        value={metrics.privacyRiskScore}
        maxValue={100}
        icon={<ShieldIcon size={18} />}
        color="var(--orange)"
        ringColor="var(--orange)"
      />
      <MetricCard
        label="Injection Risk"
        value={metrics.injectionRiskScore}
        maxValue={100}
        icon={<AlertIcon size={18} />}
        color="var(--red)"
        ringColor="var(--red)"
      />
      <MetricCard
        label="Sensitive Elements"
        value={metrics.sensitiveElements}
        icon={<LockIcon size={18} />}
        color="var(--yellow)"
      />
      <MetricCard
        label="Suspicious"
        value={metrics.suspiciousInstructions}
        icon={<EyeIcon size={18} />}
        color="var(--red)"
      />
      <MetricCard
        label="Pages Scanned"
        value={metrics.pagesScanned}
        icon={<GlobeIcon size={18} />}
        color="var(--cyan)"
      />
    </div>
  )
}

function MetricCard({
  label,
  value,
  maxValue,
  icon,
  color,
  ringColor,
}: {
  label: string
  value: number
  maxValue?: number
  icon: React.ReactNode
  color: string
  ringColor?: string
}) {
  const showRing = maxValue !== undefined && ringColor
  return (
    <div style={{
      padding: 'var(--space-lg)',
      background: 'var(--bg-card)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{
            fontSize: 13,
            fontWeight: 400,
            color: 'var(--text-muted)',
          }}>
            {label}
          </span>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--radius)',
            background: 'var(--bg-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color,
          }}>
            {icon}
          </div>
        </div>

        {showRing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <MiniRing value={value} max={maxValue} color={ringColor} />
            <div>
              <span style={{
                fontSize: 32,
                fontWeight: 300,
                fontFamily: 'var(--font-display)',
                color: 'var(--text-heading)',
                lineHeight: 1,
              }}>
                {value}
              </span>
              <span style={{ fontSize: 14, color: 'var(--text-muted)', marginLeft: 2 }}>
                /{maxValue}
              </span>
              <p style={{
                fontSize: 11,
                color: riskLabel(value).color,
                marginTop: 4,
                fontWeight: 500,
                letterSpacing: '0.02em',
              }}>
                {riskLabel(value).text}
              </p>
            </div>
          </div>
        ) : (
          <div>
            <span style={{
              fontSize: 32,
              fontWeight: 300,
              fontFamily: 'var(--font-display)',
              color: 'var(--text-heading)',
              lineHeight: 1,
            }}>
              {value.toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function riskLabel(score: number): { text: string; color: string } {
  if (score >= 80) return { text: 'Critical', color: 'var(--red)' }
  if (score >= 60) return { text: 'High Risk', color: 'var(--orange)' }
  if (score >= 40) return { text: 'Moderate', color: 'var(--yellow)' }
  if (score >= 20) return { text: 'Low Risk', color: 'var(--green)' }
  return { text: 'Minimal', color: 'var(--green)' }
}

function MiniRing({ value, max, color }: { value: number; max: number; color: string }) {
  const r = 26
  const stroke = 4
  const circ = 2 * Math.PI * r
  const offset = circ - (value / max) * circ
  const sz = (r + stroke) * 2

  return (
    <svg width={sz} height={sz} viewBox={`0 0 ${sz} ${sz}`}>
      <circle
        cx={sz / 2} cy={sz / 2} r={r}
        fill="none"
        stroke="var(--border)"
        strokeWidth={stroke}
      />
      <circle
        cx={sz / 2} cy={sz / 2} r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${sz / 2} ${sz / 2})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        opacity={0.8}
      />
    </svg>
  )
}

/* ─── Analysis Pipeline ─────────────────────────────────────────── */

const PIPELINE_ICONS: Record<string, React.ReactNode> = {
  'capture': <CameraIcon size={16} />,
  'dom-analysis': <CodeIcon size={16} />,
  'visual-analysis': <ImageIcon size={16} />,
  'privacy-scan': <ShieldIcon size={16} />,
  'injection-scan': <AlertIcon size={16} />,
  'sanitization': <FilterIcon size={16} />,
}

const STATUS_STYLES: Record<PipelineStatus, { iconBg: string; iconColor: string; glow: string }> = {
  idle: {
    iconBg: 'var(--bg-input)',
    iconColor: 'var(--text-muted)',
    glow: 'none',
  },
  active: {
    iconBg: 'var(--accent-muted)',
    iconColor: 'var(--accent-hover)',
    glow: '0 0 10px var(--accent-muted)',
  },
  complete: {
    iconBg: 'var(--green-muted)',
    iconColor: 'var(--green)',
    glow: 'none',
  },
  warning: {
    iconBg: 'var(--orange-muted)',
    iconColor: 'var(--orange)',
    glow: 'none',
  },
  error: {
    iconBg: 'var(--red-muted)',
    iconColor: 'var(--red)',
    glow: 'none',
  },
}

function AnalysisPipeline() {
  return (
    <Panel
      title="Analysis Pipeline"
      subtitle="Real-time processing flow"
      action={<Badge variant="info" dot>Live</Badge>}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        overflowX: 'auto',
        padding: '4px 0',
      }}>
        {mockPipeline.map((step, i) => {
          const s = STATUS_STYLES[step.status]
          const isLast = i === mockPipeline.length - 1
          const borderColor = step.status === 'active' ? 'var(--accent)' : step.status === 'complete' ? 'var(--green)' : 'var(--border)'
          return (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', flex: isLast ? '0 0 auto' : '1 1 0', minWidth: 0 }}>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                minWidth: 100,
                flex: '0 0 auto',
              }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  border: `1.5px solid ${borderColor}`,
                  background: s.iconBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: s.iconColor,
                  boxShadow: s.glow,
                  transition: 'all 0.3s ease',
                  position: 'relative',
                }}>
                  {step.status === 'active' && <PulseRing color="var(--accent)" />}
                  {PIPELINE_ICONS[step.id]}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: step.status === 'idle' ? 'var(--text-muted)' : 'var(--text-primary)',
                  }}>
                    {step.label}
                  </p>
                  <p style={{
                    fontSize: 10,
                    color: s.iconColor,
                    marginTop: 2,
                    maxWidth: 120,
                  }}>
                    {step.detail}
                  </p>
                </div>
              </div>

              {!isLast && (
                <div style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 24,
                  marginBottom: 30,
                }}>
                  <PipelineConnector
                    fromStatus={step.status}
                    toStatus={mockPipeline[i + 1].status}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function PulseRing({ color }: { color: string }) {
  return (
    <span style={{
      position: 'absolute',
      inset: -4,
      borderRadius: '50%',
      border: `1.5px solid ${color}`,
      opacity: 0.3,
      animation: 'pulse-ring 2s ease-out infinite',
    }} />
  )
}

function PipelineConnector({ fromStatus, toStatus }: { fromStatus: PipelineStatus; toStatus: PipelineStatus }) {
  const active = fromStatus === 'complete' || fromStatus === 'warning'
  const color = active ? 'var(--green)' : 'var(--border-light)'
  const _toActive = toStatus !== 'idle'

  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 0 }}>
      <div style={{
        flex: 1,
        height: 1,
        background: active
          ? `linear-gradient(90deg, ${color}, ${_toActive ? color : 'var(--border-light)'})`
          : 'var(--border-light)',
      }} />
      <div style={{ color: active ? color : 'var(--border-light)', flexShrink: 0, lineHeight: 0 }}>
        <ChevronRightIcon size={12} />
      </div>
    </div>
  )
}

/* ─── Recent Scans Table ────────────────────────────────────────── */

const SCAN_STATUS_STYLES: Record<ScanStatus, { label: string; variant: RiskLevel | 'info' | 'default' }> = {
  clean: { label: 'Clean', variant: 'none' },
  warning: { label: 'Warning', variant: 'medium' },
  critical: { label: 'Critical', variant: 'critical' },
  scanning: { label: 'Scanning', variant: 'info' },
  error: { label: 'Error', variant: 'critical' },
}

function scanResultToRecentScan(result: ScanResult): RecentScan {
  const privacyScore = result.risk.privacy
  const injectionScore = result.risk.injection
  const privacyRisk = result.risk.overall
  const injectionRisk: RiskLevel = injectionScore >= 80 ? 'critical' : injectionScore >= 60 ? 'high' : injectionScore >= 30 ? 'medium' : injectionScore > 0 ? 'low' : 'none'
  const status: ScanStatus = result.risk.overall === 'critical' ? 'critical'
    : result.risk.overall === 'none' ? 'clean' : 'warning'

  const host = result.url.replace(/^https?:\/\//, '').split('/')[0]

  return {
    id: result.id,
    website: result.url.replace(/^https?:\/\//, ''),
    favicon: host.charAt(0).toUpperCase(),
    time: result.timestamp,
    privacyRisk,
    privacyScore,
    injectionRisk,
    injectionScore,
    findings: {
      pii: result.piiMatches.length,
      injections: result.promptInjections.length,
      hidden: result.hiddenContent.length,
    },
    status,
  }
}

function RecentScansTable({ onNavigate, scanResults }: { onNavigate: (page: PageId) => void; scanResults: ScanResult[] }) {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)

  const recentScans: RecentScan[] = scanResults.length > 0
    ? scanResults.map(scanResultToRecentScan)
    : mockRecentScans

  return (
    <Panel
      title="Recent Scans"
      subtitle={`${recentScans.length} pages analyzed`}
      action={
        <Button variant="ghost" size="sm" onClick={() => onNavigate('scan-history')}>
          View all
        </Button>
      }
      noPadding
    >
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
          minWidth: 700,
        }}>
          <thead>
            <tr>
              {['Website', 'Time', 'Privacy Risk', 'Injection Risk', 'Findings', 'Status', ''].map((h) => (
                <th key={h} style={{
                  padding: '10px var(--space-lg)',
                  textAlign: 'left',
                  fontSize: 11,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--text-muted)',
                  borderBottom: '1px solid var(--border)',
                  whiteSpace: 'nowrap',
                  fontFamily: 'var(--font-body)',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recentScans.map((scan) => (
              <ScanRow
                key={scan.id}
                scan={scan}
                hovered={hoveredRow === scan.id}
                onHover={setHoveredRow}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function ScanRow({ scan, hovered, onHover }: { scan: RecentScan; hovered: boolean; onHover: (id: string | null) => void }) {
  const statusInfo = SCAN_STATUS_STYLES[scan.status]
  const totalFindings = scan.findings.pii + scan.findings.injections + scan.findings.hidden

  return (
    <tr
      onMouseEnter={() => onHover(scan.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        background: hovered ? 'var(--bg-card-hover)' : 'transparent',
        transition: 'background 0.15s ease',
        cursor: 'pointer',
      }}
    >
      <td style={{ padding: '12px var(--space-lg)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--radius)',
            background: 'var(--bg-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            flexShrink: 0,
          }}>
            {scan.favicon}
          </div>
          <span style={{
            fontFamily: 'var(--mono)',
            fontSize: 12,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 220,
            display: 'block',
          }}>
            {scan.website}
          </span>
        </div>
      </td>

      <td style={{ padding: '12px var(--space-lg)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {timeAgo(scan.time)}
        </span>
      </td>

      <td style={{ padding: '12px var(--space-lg)', borderBottom: '1px solid var(--border)' }}>
        <RiskBar score={scan.privacyScore} level={scan.privacyRisk} />
      </td>

      <td style={{ padding: '12px var(--space-lg)', borderBottom: '1px solid var(--border)' }}>
        <RiskBar score={scan.injectionScore} level={scan.injectionRisk} />
      </td>

      <td style={{ padding: '12px var(--space-lg)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {scan.findings.pii > 0 && (
            <FindingChip count={scan.findings.pii} label="PII" color="var(--orange)" />
          )}
          {scan.findings.injections > 0 && (
            <FindingChip count={scan.findings.injections} label="INJ" color="var(--red)" />
          )}
          {scan.findings.hidden > 0 && (
            <FindingChip count={scan.findings.hidden} label="HID" color="var(--yellow)" />
          )}
          {totalFindings === 0 && (
            <span style={{ fontSize: 12, color: 'var(--green)' }}>
              <CheckCircleIcon size={14} />
            </span>
          )}
        </div>
      </td>

      <td style={{ padding: '12px var(--space-lg)', borderBottom: '1px solid var(--border)' }}>
        <Badge variant={statusInfo.variant} dot>{statusInfo.label}</Badge>
      </td>

      <td style={{ padding: '12px var(--space-lg)', borderBottom: '1px solid var(--border)', width: 32 }}>
        <span style={{
          color: hovered ? 'var(--text-secondary)' : 'transparent',
          transition: 'color 0.15s ease',
          display: 'flex',
        }}>
          <ExternalLinkIcon size={14} />
        </span>
      </td>
    </tr>
  )
}

function RiskBar({ score, level }: { score: number; level: RiskLevel }) {
  const color = level === 'critical' ? 'var(--red)'
    : level === 'high' ? 'var(--orange)'
    : level === 'medium' ? 'var(--yellow)'
    : level === 'low' ? 'var(--green)'
    : 'var(--text-muted)'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 100 }}>
      <div style={{
        flex: 1,
        height: 3,
        borderRadius: 2,
        background: 'var(--border)',
        overflow: 'hidden',
        maxWidth: 60,
      }}>
        <div style={{
          height: '100%',
          width: `${Math.min(score, 100)}%`,
          borderRadius: 2,
          background: color,
          opacity: 0.8,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 500, color, fontVariantNumeric: 'tabular-nums', minWidth: 20, textAlign: 'right' }}>
        {score}
      </span>
    </div>
  )
}

function FindingChip({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      padding: '2px 7px',
      borderRadius: 'var(--radius-sm)',
      fontSize: 10,
      fontWeight: 600,
      fontFamily: 'var(--mono)',
      color,
      background: `color-mix(in srgb, ${color} 10%, transparent)`,
      whiteSpace: 'nowrap',
    }}>
      {count} {label}
    </span>
  )
}
