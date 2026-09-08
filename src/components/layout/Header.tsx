import type { PageId } from '../../types/navigation'
import { SearchIcon, BellIcon, MenuIcon } from '../ui/Icons'
import { Badge } from '../ui/Badge'

const PAGE_TITLES: Record<PageId, string> = {
  'dashboard': 'Dashboard',
  'browser-capture': 'Browser Capture',
  'privacy-scanner': 'Privacy Scanner',
  'injection-scanner': 'Injection Scanner',
  'visual-analysis': 'Visual Analysis',
  'sanitized-context': 'Sanitized Context',
  'security-report': 'Security Report',
  'scan-history': 'Scan History',
  'settings': 'Settings',
  'agent-prompt': 'Agent Prompt',
}

interface HeaderProps {
  activePage: PageId
  onMenuClick: () => void
}

export function Header({ activePage, onMenuClick }: HeaderProps) {
  return (
    <header style={{
      height: 'var(--header-height)',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 var(--space-lg)',
      gap: 16,
      position: 'sticky',
      top: 0,
      zIndex: 30,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={onMenuClick}
          className="header-menu-btn"
          style={{
            display: 'none',
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <MenuIcon size={20} />
        </button>
        <h2 style={{
          fontSize: 20,
          fontWeight: 400,
          fontFamily: 'var(--font-display)',
          letterSpacing: '-0.01em',
        }}>{PAGE_TITLES[activePage]}</h2>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 14px',
          borderRadius: 'var(--radius)',
          background: 'var(--bg-card)',
          color: 'var(--text-muted)',
          fontSize: 13,
          minWidth: 160,
        }}>
          <SearchIcon size={14} />
          <span>Search...</span>
        </div>

        <div style={{ position: 'relative' }}>
          <button style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 6,
            borderRadius: 'var(--radius)',
            display: 'flex',
            transition: 'color 0.15s ease',
          }}>
            <BellIcon size={17} />
          </button>
          <span style={{
            position: 'absolute',
            top: 5,
            right: 5,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--red)',
            border: '1.5px solid var(--bg-secondary)',
          }} />
        </div>

        <Badge variant="info" dot>Protected</Badge>
      </div>
    </header>
  )
}
