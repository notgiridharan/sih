import type { ScanResult } from '../types/scan'
import { RiskBadge } from './RiskBadge'

interface ScanHistoryProps {
  history: ScanResult[]
  onSelect: (result: ScanResult) => void
  onClear: () => void
}

export function ScanHistory({ history, onSelect, onClear }: ScanHistoryProps) {
  if (history.length === 0) return null

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Scan History</h3>
        <button
          onClick={onClear}
          style={{
            padding: '4px 10px',
            borderRadius: 4,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {history.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelect(r)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--code-bg)',
              color: 'var(--text-h)',
              fontSize: 13,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <RiskBadge level={r.risk.overall} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.url || 'Manual input'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text)' }}>
              {new Date(r.timestamp).toLocaleString()}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
