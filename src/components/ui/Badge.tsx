import type { RiskLevel } from '../../types/scan'

type BadgeVariant = RiskLevel | 'info' | 'default'

const STYLES: Record<BadgeVariant, { bg: string; color: string }> = {
  none: { bg: 'var(--green-muted)', color: 'var(--green)' },
  low: { bg: 'var(--green-muted)', color: 'var(--green)' },
  medium: { bg: 'var(--yellow-muted)', color: 'var(--yellow)' },
  high: { bg: 'var(--orange-muted)', color: 'var(--orange)' },
  critical: { bg: 'var(--red-muted)', color: 'var(--red)' },
  info: { bg: 'var(--cyan-muted)', color: 'var(--cyan)' },
  default: { bg: 'var(--accent-muted)', color: 'var(--accent-hover)' },
}

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  dot?: boolean
}

export function Badge({ variant = 'default', children, dot = false }: BadgeProps) {
  const s = STYLES[variant]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 10px',
        borderRadius: 'var(--radius)',
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        color: s.color,
        background: s.bg,
        whiteSpace: 'nowrap',
        fontFamily: 'var(--font-body)',
      }}
    >
      {dot && (
        <span style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: s.color,
          flexShrink: 0,
        }} />
      )}
      {children}
    </span>
  )
}
