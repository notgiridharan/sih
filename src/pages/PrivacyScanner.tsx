import { useState, useMemo } from 'react'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { ShieldIcon, EyeIcon } from '../components/ui/Icons'
import type { ScanResult, PIIMatch, PIICategory, RiskLevel } from '../types/scan'
import { mockScanHistory } from '../data/mock'

interface PrivacyScannerProps {
  scanResults: ScanResult[]
}

const CATEGORY_META: Record<PIICategory, { label: string; icon: string; group: string }> = {
  email: { label: 'Email', icon: '@', group: 'Contact' },
  phone: { label: 'Phone', icon: '#', group: 'Contact' },
  name: { label: 'Name', icon: 'N', group: 'Identity' },
  address: { label: 'Address', icon: 'A', group: 'Contact' },
  date_of_birth: { label: 'Date of Birth', icon: 'D', group: 'Identity' },
  ssn: { label: 'SSN', icon: 'S', group: 'Government ID' },
  pan: { label: 'PAN', icon: 'P', group: 'Government ID' },
  aadhaar: { label: 'Aadhaar', icon: 'A', group: 'Government ID' },
  bank_account: { label: 'Bank Info', icon: 'B', group: 'Financial' },
  upi_id: { label: 'UPI ID', icon: 'U', group: 'Financial' },
  credit_card: { label: 'Credit Card', icon: 'C', group: 'Financial' },
  password_field: { label: 'Password', icon: '!', group: 'Credential' },
  api_key: { label: 'API Key', icon: 'K', group: 'Credential' },
  session_id: { label: 'Session ID', icon: 'S', group: 'Credential' },
  custom: { label: 'Custom', icon: '?', group: 'Other' },
}

const RISK_CONFIG: Record<RiskLevel, { color: string; bg: string; label: string }> = {
  critical: { color: 'var(--red)', bg: 'var(--red-muted)', label: 'Critical' },
  high: { color: 'var(--orange)', bg: 'var(--orange-muted)', label: 'High' },
  medium: { color: 'var(--yellow)', bg: 'var(--yellow-muted)', label: 'Medium' },
  low: { color: 'var(--green)', bg: 'var(--green-muted)', label: 'Low' },
  none: { color: 'var(--text-muted)', bg: 'var(--bg-input)', label: 'None' },
}

const DETECTION_RULES = [
  { name: 'Email addresses', pattern: 'RFC 5322 regex', active: true },
  { name: 'Phone numbers', pattern: 'US/IN formats', active: true },
  { name: 'SSN', pattern: 'XXX-XX-XXXX', active: true },
  { name: 'Credit cards', pattern: 'Luhn-validated', active: true },
  { name: 'PAN (India)', pattern: 'ABCDE1234F', active: true },
  { name: 'Aadhaar (India)', pattern: '12-digit Verhoeff', active: true },
  { name: 'UPI IDs', pattern: 'user@provider', active: true },
  { name: 'Bank info', pattern: 'IFSC / SWIFT / Routing', active: true },
  { name: 'API keys / tokens', pattern: 'Known key prefixes', active: true },
  { name: 'Session identifiers', pattern: 'Session token patterns', active: true },
  { name: 'Date of birth', pattern: 'Context-aware date', active: true },
  { name: 'Password fields', pattern: 'DOM type=password', active: true },
  { name: 'Addresses', pattern: 'Street heuristics', active: true },
  { name: 'Names (NER)', pattern: 'ML entity recognition', active: false },
  { name: 'Custom patterns', pattern: 'User-defined regex', active: false },
]

export function PrivacyScanner({ scanResults }: PrivacyScannerProps) {
  const data = scanResults.length > 0 ? scanResults : mockScanHistory
  const isDemo = scanResults.length === 0

  const allPii = useMemo(() =>
    data.flatMap((s) =>
      s.piiMatches.map((m) => ({ ...m, url: s.url, scanTime: s.timestamp }))
    ),
    [data]
  )

  const [filterRisk, setFilterRisk] = useState<RiskLevel | 'all'>('all')
  const [filterCategory, setFilterCategory] = useState<PIICategory | 'all'>('all')
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const filtered = useMemo(() =>
    allPii.filter((m) =>
      (filterRisk === 'all' || m.risk === filterRisk) &&
      (filterCategory === 'all' || m.type === filterCategory)
    ),
    [allPii, filterRisk, filterCategory]
  )

  const riskCounts = useMemo(() => {
    const counts: Record<RiskLevel, number> = { critical: 0, high: 0, medium: 0, low: 0, none: 0 }
    for (const m of allPii) counts[m.risk ?? 'medium']++
    return counts
  }, [allPii])

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<PIICategory, number>> = {}
    for (const m of allPii) counts[m.type] = (counts[m.type] || 0) + 1
    return counts
  }, [allPii])

  const activeCategories = Object.entries(categoryCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([cat]) => cat as PIICategory)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      {/* Risk distribution */}
      <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
        {(['critical', 'high', 'medium', 'low'] as RiskLevel[]).map((level) => {
          const rc = RISK_CONFIG[level]
          const count = riskCounts[level]
          const active = filterRisk === level

          return (
            <button
              key={level}
              onClick={() => setFilterRisk(active ? 'all' : level)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '12px 14px',
                background: active ? rc.bg : 'var(--bg-card)',
                border: active ? `1px solid ${rc.color}` : '1px solid transparent',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 500, fontFamily: 'var(--font-body)' }}>
                {rc.label}
              </span>
              <span style={{ fontSize: 28, fontFamily: 'var(--font-display)', fontWeight: 300, color: count > 0 ? rc.color : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Category breakdown */}
      {activeCategories.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          padding: 'var(--space-sm) var(--space-md)',
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius)',
        }}>
          <button
            onClick={() => setFilterCategory('all')}
            style={{
              padding: '4px 10px',
              borderRadius: 12,
              border: 'none',
              background: filterCategory === 'all' ? 'var(--accent-muted)' : 'transparent',
              color: filterCategory === 'all' ? 'var(--accent-hover)' : 'var(--text-muted)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            All ({allPii.length})
          </button>
          {activeCategories.map((cat) => {
            const meta = CATEGORY_META[cat]
            const count = categoryCounts[cat] || 0
            const active = filterCategory === cat

            return (
              <button
                key={cat}
                onClick={() => setFilterCategory(active ? 'all' : cat)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 12,
                  border: 'none',
                  background: active ? 'var(--accent-muted)' : 'transparent',
                  color: active ? 'var(--accent-hover)' : 'var(--text-secondary)',
                  fontSize: 11,
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.1s',
                }}
              >
                {meta.label} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Findings list */}
      <Panel
        title="Privacy Findings"
        subtitle={`${filtered.length} of ${allPii.length} findings${isDemo ? ' (demo data)' : ''}`}
        action={
          (filterRisk !== 'all' || filterCategory !== 'all') && (
            <Button variant="ghost" size="sm" onClick={() => { setFilterRisk('all'); setFilterCategory('all') }}>
              Clear Filters
            </Button>
          )
        }
        noPadding
      >
        {filtered.length === 0 ? (
          <EmptyState hasFilters={filterRisk !== 'all' || filterCategory !== 'all'} />
        ) : (
          <div>
            {filtered.map((m, i) => (
              <FindingRow
                key={`${m.type}-${i}`}
                match={m}
                expanded={expandedIdx === i}
                onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
              />
            ))}
          </div>
        )}
      </Panel>

      {/* Detection rules */}
      <Panel title="Detection Engine" subtitle={`${DETECTION_RULES.filter((r) => r.active).length} active rules — extensible for ML models`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {DETECTION_RULES.map((r) => (
            <div key={r.name} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '7px 0',
              borderBottom: '1px solid var(--border)',
              fontSize: 13,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: r.active ? 'var(--green)' : 'var(--text-muted)',
                  flexShrink: 0,
                }} />
                <span style={{ color: 'var(--text-primary)' }}>{r.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{r.pattern}</span>
              </div>
              <Badge variant={r.active ? 'none' : 'default'}>{r.active ? 'Active' : 'Planned'}</Badge>
            </div>
          ))}
        </div>
      </Panel>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Badge variant="info" dot>Local Processing</Badge>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            All privacy detection runs locally in your browser. Sensitive values are never displayed in full or transmitted externally.
          </p>
        </div>
      </Card>
    </div>
  )
}

/* ─── Finding Row ─────────────────────────────────────────────── */

function FindingRow({
  match,
  expanded,
  onToggle,
}: {
  match: PIIMatch & { url: string; scanTime: number }
  expanded: boolean
  onToggle: () => void
}) {
  const meta = CATEGORY_META[match.type] || CATEGORY_META.custom
  const risk = RISK_CONFIG[match.risk ?? 'medium']

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Summary row */}
      <div
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: '32px 1fr 100px 80px 40px',
          gap: 10,
          padding: '12px 20px',
          alignItems: 'center',
          cursor: 'pointer',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-card-hover)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        {/* Category icon */}
        <div style={{
          width: 28,
          height: 28,
          borderRadius: 'var(--radius-sm)',
          background: risk.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 700,
          color: risk.color,
          fontFamily: 'var(--mono)',
        }}>
          {meta.icon}
        </div>

        {/* Category + redacted preview */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{meta.label}</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '1px 5px', background: 'var(--bg-input)', borderRadius: 3 }}>
              {meta.group}
            </span>
          </div>
          <code style={{
            fontSize: 11,
            fontFamily: 'var(--mono)',
            color: 'var(--text-secondary)',
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {match.redacted}
          </code>
        </div>

        {/* Risk */}
        <Badge variant={match.risk as 'critical' | 'high' | 'medium' | 'low' | 'none'} dot>
          {risk.label}
        </Badge>

        {/* Confidence */}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
          {((match.confidence ?? 0.9) * 100).toFixed(0)}%
        </span>

        {/* Expand arrow */}
        <span style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          transition: 'transform 0.15s',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          textAlign: 'center',
        }}>
          &#9654;
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          padding: '0 20px 14px 62px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px 20px',
          animation: 'fade-in 0.15s ease',
        }}>
          <DetailField label="Category" value={meta.label} />
          <DetailField label="Group" value={meta.group} />
          <DetailField label="Risk Level" value={risk.label} valueColor={risk.color} />
          <DetailField label="Confidence" value={`${((match.confidence ?? 0.9) * 100).toFixed(0)}%`} />
          {match.elementTag && (
            <DetailField label="Element" value={`<${match.elementTag}>`} mono />
          )}
          {match.location.selector && (
            <DetailField label="Selector" value={match.location.selector} mono />
          )}
          <DetailField label="Detected By" value={match.detectedBy ?? 'regex'} />
          <DetailField label="Source" value={match.url || 'DOM'} mono />
          <div style={{ gridColumn: '1 / -1' }}>
            <DetailField label="Recommended Action" value={match.action ?? 'Review and redact'} valueColor="var(--cyan)" />
          </div>
        </div>
      )}
    </div>
  )
}

function DetailField({
  label,
  value,
  valueColor,
  mono,
}: {
  label: string
  value: string
  valueColor?: string
  mono?: boolean
}) {
  return (
    <div>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      <p style={{
        fontSize: 12,
        color: valueColor || 'var(--text-primary)',
        fontFamily: mono ? 'var(--mono)' : 'inherit',
        marginTop: 2,
        wordBreak: 'break-word',
      }}>
        {value}
      </p>
    </div>
  )
}

/* ─── Empty State ─────────────────────────────────────────────── */

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '40px 20px',
      color: 'var(--text-muted)',
      gap: 8,
    }}>
      {hasFilters ? (
        <>
          <EyeIcon size={36} />
          <p style={{ fontSize: 13 }}>No findings match current filters.</p>
        </>
      ) : (
        <>
          <ShieldIcon size={36} />
          <p style={{ fontSize: 13 }}>No PII detected. Run a scan from Browser Capture to begin.</p>
        </>
      )}
    </div>
  )
}
