import type { ReactNode } from 'react'
import type { PageId } from '../../types/navigation'
import { Sidebar } from './Sidebar'
import { Header } from './Header'

interface LayoutProps {
  activePage: PageId
  onNavigate: (page: PageId) => void
  sidebarOpen: boolean
  onSidebarToggle: () => void
  children: ReactNode
}

export function Layout({ activePage, onNavigate, sidebarOpen, onSidebarToggle, children }: LayoutProps) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        activePage={activePage}
        onNavigate={onNavigate}
        open={sidebarOpen}
        onClose={() => onSidebarToggle()}
      />

      <div
        style={{
          flex: 1,
          marginLeft: 'var(--sidebar-width)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
        }}
        className="main-area"
      >
        <Header activePage={activePage} onMenuClick={onSidebarToggle} />

        <main style={{
          flex: 1,
          padding: 'var(--space-xl)',
          overflowY: 'auto',
          height: 'calc(100vh - var(--header-height))',
        }}>
          {children}
        </main>
      </div>
    </div>
  )
}
