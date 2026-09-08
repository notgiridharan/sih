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
        borderRadius: 'var(--radius-lg)',
        padding: padding ? 'var(--space-lg)' : 0,
        cursor: onClick ? 'pointer' : undefined,
        transition: 'background 0.2s ease',
        ...style,
      }}
      onMouseEnter={hover ? (e) => {
        e.currentTarget.style.background = 'var(--bg-card-hover)'
      } : undefined}
      onMouseLeave={hover ? (e) => {
        e.currentTarget.style.background = 'var(--bg-card)'
      } : undefined}
    >
      {children}
    </div>
  )
}
