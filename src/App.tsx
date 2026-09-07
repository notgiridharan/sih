import { useState, useCallback, useEffect } from 'react'
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
import { saveScan, getScans, clearScans as clearStorage, deleteScan as deleteFromStorage } from './services/storage'

function PageContent({
  page,
  onNavigate,
  scanResults,
  storedScans,
  onScan,
  onClearHistory,
  onDeleteScan,
  onViewScan,
  viewingScan,
  lastCapturedDOM,
  onCaptureDOM,
  storageError,
}: {
  page: PageId
  onNavigate: (p: PageId) => void
  scanResults: ScanResult[]
  storedScans: ScanResult[]
  onScan: (result: ScanResult) => void
  onClearHistory: () => void
  onDeleteScan: (id: string) => void
  onViewScan: (result: ScanResult) => void
  viewingScan: ScanResult | null
  lastCapturedDOM: string | null
  onCaptureDOM: (dom: string) => void
  storageError: string | null
}) {
  switch (page) {
    case 'dashboard': return <Dashboard onNavigate={onNavigate} scanResults={scanResults} storedScans={storedScans} />
    case 'browser-capture': return <BrowserCapture onScan={onScan} onNavigate={onNavigate} onCaptureDOM={onCaptureDOM} />
    case 'privacy-scanner': return <PrivacyScanner scanResults={viewingScan ? [viewingScan] : scanResults} />
    case 'injection-scanner': return <InjectionScanner scanResults={viewingScan ? [viewingScan] : scanResults} />
    case 'visual-analysis': return <VisualAnalysis scanResults={viewingScan ? [viewingScan] : scanResults} capturedDOM={lastCapturedDOM} viewingScan={viewingScan} />
    case 'sanitized-context': return <SanitizedContext scanResults={viewingScan ? [viewingScan] : scanResults} capturedDOM={lastCapturedDOM} />
    case 'security-report': return <SecurityReport scanResults={viewingScan ? [viewingScan] : scanResults} />
    case 'scan-history': return (
      <ScanHistoryPage
        scanResults={scanResults}
        storedScans={storedScans}
        onClearHistory={onClearHistory}
        onDeleteScan={onDeleteScan}
        onViewScan={onViewScan}
        onNavigate={onNavigate}
        storageError={storageError}
      />
    )
    case 'settings': return <Settings />
  }
}

export function App() {
  const [activePage, setActivePage] = useState<PageId>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [scanResults, setScanResults] = useState<ScanResult[]>([])
  const [storedScans, setStoredScans] = useState<ScanResult[]>([])
  const [lastCapturedDOM, setLastCapturedDOM] = useState<string | null>(null)
  const [viewingScan, setViewingScan] = useState<ScanResult | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)

  useEffect(() => {
    setStoredScans(getScans())
  }, [])

  const handleScan = useCallback((result: ScanResult) => {
    setScanResults((prev) => [result, ...prev])
    setViewingScan(null)
    const { success, error } = saveScan(result)
    if (!success) {
      setStorageError(error ?? 'Failed to save scan')
      setTimeout(() => setStorageError(null), 5000)
    }
    setStoredScans(getScans())
  }, [])

  const handleClearHistory = useCallback(() => {
    clearStorage()
    setStoredScans([])
    setScanResults([])
    setViewingScan(null)
  }, [])

  const handleDeleteScan = useCallback((id: string) => {
    deleteFromStorage(id)
    setStoredScans(getScans())
    setScanResults((prev) => prev.filter(s => s.id !== id))
    if (viewingScan?.id === id) setViewingScan(null)
  }, [viewingScan])

  const handleViewScan = useCallback((result: ScanResult) => {
    setViewingScan(result)
    setActivePage('visual-analysis')
  }, [])

  const handleNavigate = useCallback((page: PageId) => {
    if (page === 'browser-capture' || page === 'dashboard' || page === 'scan-history') {
      setViewingScan(null)
    }
    setActivePage(page)
  }, [])

  return (
    <Layout
      activePage={activePage}
      onNavigate={handleNavigate}
      sidebarOpen={sidebarOpen}
      onSidebarToggle={() => setSidebarOpen((o) => !o)}
    >
      <PageContent
        page={activePage}
        onNavigate={handleNavigate}
        scanResults={scanResults}
        storedScans={storedScans}
        onScan={handleScan}
        onClearHistory={handleClearHistory}
        onDeleteScan={handleDeleteScan}
        onViewScan={handleViewScan}
        viewingScan={viewingScan}
        lastCapturedDOM={lastCapturedDOM}
        onCaptureDOM={setLastCapturedDOM}
        storageError={storageError}
      />
    </Layout>
  )
}
