import type { ReactNode } from 'react'

interface PanelProps {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  noPadding?: boolean
}

export function Panel({ title, subtitle, action, children, noPadding = false }: PanelProps) {
  return (
    <section style={{
      borderRadius: 'var(--radius-lg)',
      background: 'var(--bg-card)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        padding: 'var(--space-lg)',
        paddingBottom: 'var(--space-md)',
      }}>
        <div>
          <h3 style={{
            fontSize: 18,
            fontWeight: 400,
            fontFamily: 'var(--font-display)',
            letterSpacing: '-0.01em',
          }}>{title}</h3>
          {subtitle && (
            <p style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              marginTop: 2,
              fontFamily: 'var(--font-body)',
            }}>{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      <div style={{ padding: noPadding ? 0 : `0 var(--space-lg) var(--space-lg)` }}>
        {children}
      </div>
    </section>
  )
}
