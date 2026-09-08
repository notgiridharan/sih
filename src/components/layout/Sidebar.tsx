import type { PageId } from '../../types/navigation'
import {
  DashboardIcon,
  GlobeIcon,
  ShieldIcon,
  AlertIcon,
  EyeIcon,
  FileTextIcon,
  ClipboardIcon,
  ClockIcon,
  SettingsIcon,
  LockIcon,
  XIcon,
  BotIcon,
} from '../ui/Icons'

interface NavItem {
  id: PageId
  label: string
  icon: React.ReactNode
  section?: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
  { id: 'browser-capture', label: 'Browser Capture', icon: <GlobeIcon />, section: 'Analysis' },
  { id: 'privacy-scanner', label: 'Privacy Scanner', icon: <ShieldIcon /> },
  { id: 'injection-scanner', label: 'Injection Scanner', icon: <AlertIcon /> },
  { id: 'visual-analysis', label: 'DOM Analysis', icon: <EyeIcon /> },
  { id: 'sanitized-context', label: 'Sanitized Context', icon: <FileTextIcon />, section: 'Output' },
  { id: 'security-report', label: 'Security Report', icon: <ClipboardIcon /> },
  { id: 'agent-prompt', label: 'Agent Prompt', icon: <BotIcon />, section: 'Agent' },
  { id: 'scan-history', label: 'Scan History', icon: <ClockIcon />, section: 'History' },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
]

interface SidebarProps {
  activePage: PageId
  onNavigate: (page: PageId) => void
  open: boolean
  onClose: () => void
}

export function Sidebar({ activePage, onNavigate, open, onClose }: SidebarProps) {
  let lastSection: string | undefined

  return (
    <>
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 40,
            display: 'none',
          }}
          className="sidebar-overlay"
        />
      )}
      <aside
        className={`sidebar ${open ? 'sidebar--open' : ''}`}
        style={{
          width: 'var(--sidebar-width)',
          height: '100vh',
          background: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: 0,
          left: 0,
          zIndex: 50,
          transition: 'transform 0.2s ease',
        }}
      >
        <div style={{
          padding: '20px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          height: 'var(--header-height)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 28,
              height: 28,
              borderRadius: 'var(--radius)',
              background: 'var(--accent-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent)',
            }}>
              <LockIcon size={14} />
            </div>
            <div>
              <h1 style={{
                fontSize: 15,
                fontWeight: 400,
                fontFamily: 'var(--font-display)',
                lineHeight: 1.2,
                letterSpacing: '-0.01em',
              }}>Sentinel Lens</h1>
            </div>
          </div>
          <button
            onClick={onClose}
            className="sidebar-close"
            style={{
              display: 'none',
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <XIcon size={18} />
          </button>
        </div>

        <nav style={{ flex: 1, overflowY: 'auto', padding: '12px 12px' }}>
          {NAV_ITEMS.map((item) => {
            const showSection = item.section && item.section !== lastSection
            if (item.section) lastSection = item.section
            const active = activePage === item.id

            return (
              <div key={item.id}>
                {showSection && (
                  <p style={{
                    fontSize: 10,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    color: 'var(--text-muted)',
                    padding: '18px 10px 6px',
                    margin: 0,
                    fontFamily: 'var(--font-body)',
                  }}>
                    {item.section}
                  </p>
                )}
                <button
                  onClick={() => { onNavigate(item.id); onClose() }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius)',
                    border: 'none',
                    background: active ? 'var(--accent-muted)' : 'transparent',
                    color: active ? 'var(--accent-hover)' : 'var(--text-secondary)',
                    fontSize: 13,
                    fontWeight: active ? 500 : 400,
                    fontFamily: 'var(--font-body)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.15s ease, color 0.15s ease',
                    letterSpacing: '0.01em',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = 'var(--bg-card)'
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              </div>
            )
          })}
        </nav>

        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--border)',
          fontSize: 11,
          color: 'var(--text-muted)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--green)',
              opacity: 0.8,
            }} />
            Local processing
          </div>
        </div>
      </aside>
    </>
  )
}
