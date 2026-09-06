import type { ReactNode } from 'react'
import { Card } from './Card'

interface PanelProps {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  noPadding?: boolean
}

export function Panel({ title, subtitle, action, children, noPadding = false }: PanelProps) {
  return (
    <Card padding={false}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
      }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600 }}>{title}</h3>
          {subtitle && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      <div style={{ padding: noPadding ? 0 : 20 }}>
        {children}
      </div>
    </Card>
  )
}
