import { useState } from 'react'
import type { PageId } from './types/navigation'
import { Layout } from './components/layout/Layout'
import { Dashboard } from './pages/Dashboard'
import { BrowserCapture } from './pages/BrowserCapture'
import { PrivacyScanner } from './pages/PrivacyScanner'
import { InjectionScanner } from './pages/InjectionScanner'
import { VisualAnalysis } from './pages/VisualAnalysis'
import { SanitizedContext } from './pages/SanitizedContext'
import { SecurityReport } from './pages/SecurityReport'
import { ScanHistoryPage } from './pages/ScanHistoryPage'
import { Settings } from './pages/Settings'

function PageContent({ page, onNavigate }: { page: PageId; onNavigate: (p: PageId) => void }) {
  switch (page) {
    case 'dashboard': return <Dashboard onNavigate={onNavigate} />
    case 'browser-capture': return <BrowserCapture />
    case 'privacy-scanner': return <PrivacyScanner />
    case 'injection-scanner': return <InjectionScanner />
    case 'visual-analysis': return <VisualAnalysis />
    case 'sanitized-context': return <SanitizedContext />
    case 'security-report': return <SecurityReport />
    case 'scan-history': return <ScanHistoryPage />
    case 'settings': return <Settings />
  }
}

export function App() {
  const [activePage, setActivePage] = useState<PageId>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <Layout
      activePage={activePage}
      onNavigate={setActivePage}
      sidebarOpen={sidebarOpen}
      onSidebarToggle={() => setSidebarOpen((o) => !o)}
    >
      <PageContent page={activePage} onNavigate={setActivePage} />
    </Layout>
  )
}
