interface StatCardProps {
  label: string
  value: string | number
  icon: React.ReactNode
  trend?: { value: string; positive: boolean }
  color?: string
}

export function StatCard({ label, value, icon, trend, color = 'var(--accent)' }: StatCardProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      padding: 'var(--space-lg)',
      background: 'var(--bg-card)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <div>
        <p style={{
          fontSize: 13,
          color: 'var(--text-muted)',
          marginBottom: 8,
          fontWeight: 400,
          letterSpacing: '0.01em',
        }}>
          {label}
        </p>
        <p style={{
          fontSize: 28,
          fontWeight: 300,
          fontFamily: 'var(--font-display)',
          color: 'var(--text-heading)',
          lineHeight: 1,
        }}>
          {value}
        </p>
        {trend && (
          <p style={{
            fontSize: 12,
            marginTop: 8,
            color: trend.positive ? 'var(--green)' : 'var(--red)',
            fontWeight: 500,
          }}>
            {trend.positive ? '+' : ''}{trend.value}
          </p>
        )}
      </div>
      <div style={{
        width: 36,
        height: 36,
        borderRadius: 'var(--radius)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color,
        flexShrink: 0,
      }}>
        {icon}
      </div>
    </div>
  )
}
