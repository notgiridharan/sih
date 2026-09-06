import type { CSSProperties, ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  padding?: boolean
  hover?: boolean
  onClick?: () => void
}

export function Card({ children, style, padding = true, hover = false, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: padding ? 20 : 0,
        cursor: onClick ? 'pointer' : undefined,
        transition: 'background 0.15s, border-color 0.15s',
        ...(hover ? { ':hover': {} } : {}),
        ...style,
      }}
      onMouseEnter={hover ? (e) => {
        e.currentTarget.style.background = 'var(--bg-card-hover)'
        e.currentTarget.style.borderColor = 'var(--border-light)'
      } : undefined}
      onMouseLeave={hover ? (e) => {
        e.currentTarget.style.background = 'var(--bg-card)'
        e.currentTarget.style.borderColor = 'var(--border)'
      } : undefined}
    >
      {children}
    </div>
  )
}
