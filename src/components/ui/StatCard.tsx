import { Card } from './Card'

interface StatCardProps {
  label: string
  value: string | number
  icon: React.ReactNode
  trend?: { value: string; positive: boolean }
  color?: string
}

export function StatCard({ label, value, icon, trend, color = 'var(--accent)' }: StatCardProps) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>
            {label}
          </p>
          <p style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-heading)', lineHeight: 1 }}>
            {value}
          </p>
          {trend && (
            <p style={{ fontSize: 12, marginTop: 6, color: trend.positive ? 'var(--green)' : 'var(--red)' }}>
              {trend.positive ? '↑' : '↓'} {trend.value}
            </p>
          )}
        </div>
        <div style={{
          width: 40,
          height: 40,
          borderRadius: 'var(--radius)',
          background: color.startsWith('var') ? undefined : `${color}20`,
          backgroundColor: color.startsWith('var') ? 'var(--accent-muted)' : undefined,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
          flexShrink: 0,
        }}>
          {icon}
        </div>
      </div>
    </Card>
  )
}
