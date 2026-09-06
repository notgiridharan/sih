import { useState } from 'react'
import type { ScanResult, ScanStatus } from './types/scan'
import { scan } from './services/scanner'
import { useScanHistory } from './hooks/useScanHistory'
import { ScanForm } from './components/ScanForm'
import { ScanResults } from './components/ScanResults'
import { ScanHistory } from './components/ScanHistory'

export function App() {
  const [status, setStatus] = useState<ScanStatus>('idle')
  const [currentResult, setCurrentResult] = useState<ScanResult | null>(null)
  const { history, addResult, clearHistory } = useScanHistory()

  const handleScan = (url: string, domContent: string) => {
    setStatus('analyzing')
    try {
      const result = scan({ url, dom: domContent, screenshot: null })
      setCurrentResult(result)
      addResult(result)
      setStatus('complete')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px' }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 28 }}>Privacy Vision Agent</h1>
        <p style={{ margin: 0, color: 'var(--text)', fontSize: 15 }}>
          Analyze websites for sensitive data exposure, prompt injection, and hidden content before passing context to an AI agent.
        </p>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        <ScanForm status={status} onScan={handleScan} />

        {status === 'error' && (
          <p style={{ color: '#ef4444', margin: 0 }}>Scan failed. Check the input and try again.</p>
        )}

        {currentResult && <ScanResults result={currentResult} />}

        <ScanHistory history={history} onSelect={setCurrentResult} onClear={clearHistory} />
      </div>
    </div>
  )
}
