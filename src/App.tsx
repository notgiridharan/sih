import { useState, useCallback } from 'react'
import type { PageId } from './types/navigation'
import type { ScanResult } from './types/scan'
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

function PageContent({
  page,
  onNavigate,
  scanResults,
  onScan,
  onClearHistory,
}: {
  page: PageId
  onNavigate: (p: PageId) => void
  scanResults: ScanResult[]
  onScan: (result: ScanResult) => void
  onClearHistory: () => void
}) {
  switch (page) {
    case 'dashboard': return <Dashboard onNavigate={onNavigate} scanResults={scanResults} />
    case 'browser-capture': return <BrowserCapture onScan={onScan} onNavigate={onNavigate} />
    case 'privacy-scanner': return <PrivacyScanner scanResults={scanResults} />
    case 'injection-scanner': return <InjectionScanner scanResults={scanResults} />
    case 'visual-analysis': return <VisualAnalysis scanResults={scanResults} />
    case 'sanitized-context': return <SanitizedContext scanResults={scanResults} />
    case 'security-report': return <SecurityReport scanResults={scanResults} />
    case 'scan-history': return <ScanHistoryPage scanResults={scanResults} onClearHistory={onClearHistory} />
    case 'settings': return <Settings />
  }
}

export function App() {
  const [activePage, setActivePage] = useState<PageId>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [scanResults, setScanResults] = useState<ScanResult[]>([])

  const handleScan = useCallback((result: ScanResult) => {
    setScanResults((prev) => [result, ...prev])
  }, [])

  const handleClearHistory = useCallback(() => {
    setScanResults([])
  }, [])

  return (
    <Layout
      activePage={activePage}
      onNavigate={setActivePage}
      sidebarOpen={sidebarOpen}
      onSidebarToggle={() => setSidebarOpen((o) => !o)}
    >
      <PageContent
        page={activePage}
        onNavigate={setActivePage}
        scanResults={scanResults}
        onScan={handleScan}
        onClearHistory={handleClearHistory}
      />
    </Layout>
  )
}
