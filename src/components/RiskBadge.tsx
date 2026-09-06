import type { RiskLevel } from '../types/scan'

const RISK_COLORS: Record<RiskLevel, string> = {
  none: '#22c55e',
  low: '#84cc16',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 10px',
        borderRadius: 12,
        fontSize: 13,
        fontWeight: 600,
        color: '#fff',
        background: RISK_COLORS[level],
        textTransform: 'uppercase',
      }}
    >
      {level}
    </span>
  )
}
