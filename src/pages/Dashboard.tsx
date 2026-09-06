import { StatCard } from '../components/ui/StatCard'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import {
  ShieldIcon,
  AlertIcon,
  EyeIcon,
  CheckCircleIcon,
  ActivityIcon,
  LockIcon,
} from '../components/ui/Icons'
import { mockSummary, mockRecentThreats, mockRiskOverTime } from '../data/mock'
import type { PageId } from '../types/navigation'

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

interface DashboardProps {
  onNavigate: (page: PageId) => void
}

export function Dashboard({ onNavigate }: DashboardProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
      }}>
        <StatCard
          label="Total Scans"
          value={mockSummary.totalScans}
          icon={<ActivityIcon size={20} />}
          trend={{ value: '12% this week', positive: true }}
          color="var(--accent)"
        />
        <StatCard
          label="Threats Blocked"
          value={mockSummary.threatsBlocked}
          icon={<ShieldIcon size={20} />}
          trend={{ value: '5 today', positive: false }}
          color="var(--red)"
        />
        <StatCard
          label="PII Redacted"
          value={mockSummary.piiRedacted}
          icon={<LockIcon size={20} />}
          trend={{ value: '34 this week', positive: true }}
          color="var(--orange)"
        />
        <StatCard
          label="Injections Found"
          value={mockSummary.injectionsDetected}
          icon={<AlertIcon size={20} />}
          trend={{ value: '2 critical', positive: false }}
          color="var(--yellow)"
        />
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
      }}
        className="dashboard-grid"
      >
        <Panel title="Risk Trend" subtitle="Last 7 days">
          <RiskChart data={mockRiskOverTime} />
        </Panel>

        <Panel
          title="Recent Threats"
          subtitle={`${mockRecentThreats.length} events`}
          action={
            <Button variant="ghost" size="sm" onClick={() => onNavigate('scan-history')}>
              View all
            </Button>
          }
          noPadding
        >
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {mockRecentThreats.map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 20px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 13,
                }}
              >
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--radius)',
                  background: t.type === 'pii' ? 'var(--orange-muted)' : t.type === 'injection' ? 'var(--red-muted)' : 'var(--yellow-muted)',
                  color: t.type === 'pii' ? 'var(--orange)' : t.type === 'injection' ? 'var(--red)' : 'var(--yellow)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {t.type === 'pii' ? <EyeIcon size={14} /> : t.type === 'injection' ? <AlertIcon size={14} /> : <LockIcon size={14} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {t.message}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.source}</p>
                </div>
                <Badge variant={t.severity} dot>{t.severity}</Badge>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {timeAgo(t.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 16,
      }}
        className="dashboard-grid-3"
      >
        <Panel title="Privacy Score" subtitle="Current session">
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <RingGauge value={72} color="var(--green)" />
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>72% of data sanitized successfully</p>
          </div>
        </Panel>

        <Panel title="Active Protections">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'PII Detection', active: true },
              { label: 'Injection Scanning', active: true },
              { label: 'Hidden Content Detection', active: true },
              { label: 'Screenshot Analysis', active: false },
              { label: 'DOM Cross-Validation', active: false },
            ].map((p) => (
              <div key={p.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: p.active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  <CheckCircleIcon size={14} />
                  {p.label}
                </div>
                <Badge variant={p.active ? 'none' : 'default'}>{p.active ? 'Active' : 'Planned'}</Badge>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Quick Actions">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Button variant="primary" size="md" onClick={() => onNavigate('browser-capture')} style={{ width: '100%', justifyContent: 'center' }}>
              New Scan
            </Button>
            <Button variant="secondary" size="md" onClick={() => onNavigate('security-report')} style={{ width: '100%', justifyContent: 'center' }}>
              View Report
            </Button>
            <Button variant="secondary" size="md" onClick={() => onNavigate('settings')} style={{ width: '100%', justifyContent: 'center' }}>
              Configure Rules
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function RiskChart({ data }: { data: typeof mockRiskOverTime }) {
  const maxVal = Math.max(...data.flatMap((d) => [d.privacy, d.injection, d.hidden]), 1)

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 11 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--orange)' }} />
          Privacy
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--red)' }} />
          Injection
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--yellow)' }} />
          Hidden
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
        {data.map((d) => (
          <div key={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 120, width: '100%' }}>
              <div style={{ flex: 1, background: 'var(--orange)', borderRadius: '2px 2px 0 0', height: `${(d.privacy / maxVal) * 100}%`, minHeight: 2, opacity: 0.8 }} />
              <div style={{ flex: 1, background: 'var(--red)', borderRadius: '2px 2px 0 0', height: `${(d.injection / maxVal) * 100}%`, minHeight: 2, opacity: 0.8 }} />
              <div style={{ flex: 1, background: 'var(--yellow)', borderRadius: '2px 2px 0 0', height: `${(d.hidden / maxVal) * 100}%`, minHeight: 2, opacity: 0.8 }} />
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RingGauge({ value, color }: { value: number; color: string }) {
  const radius = 50
  const stroke = 8
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference

  return (
    <svg width={128} height={128} viewBox="0 0 128 128">
      <circle
        cx="64" cy="64" r={radius}
        fill="none"
        stroke="var(--border)"
        strokeWidth={stroke}
      />
      <circle
        cx="64" cy="64" r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 64 64)"
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
      <text x="64" y="60" textAnchor="middle" fill="var(--text-heading)" fontSize="28" fontWeight="700">
        {value}
      </text>
      <text x="64" y="78" textAnchor="middle" fill="var(--text-muted)" fontSize="11">
        / 100
      </text>
    </svg>
  )
}
