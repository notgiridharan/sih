import { useState } from 'react'
import type { ScanStatus } from '../types/scan'

interface ScanFormProps {
  status: ScanStatus
  onScan: (url: string, domContent: string) => void
}

export function ScanForm({ status, onScan }: ScanFormProps) {
  const [url, setUrl] = useState('')
  const [domContent, setDomContent] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!domContent.trim()) return
    onScan(url, domContent)
  }

  const busy = status === 'capturing' || status === 'analyzing'

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={{ fontSize: 14, fontWeight: 500 }}>
        Target URL (optional)
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          style={{
            display: 'block',
            width: '100%',
            marginTop: 4,
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 14,
            boxSizing: 'border-box',
          }}
        />
      </label>

      <label style={{ fontSize: 14, fontWeight: 500 }}>
        DOM / HTML Content
        <textarea
          value={domContent}
          onChange={(e) => setDomContent(e.target.value)}
          placeholder="Paste the DOM or HTML content to analyze..."
          rows={8}
          required
          style={{
            display: 'block',
            width: '100%',
            marginTop: 4,
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 14,
            fontFamily: 'var(--mono)',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
      </label>

      <button
        type="submit"
        disabled={busy || !domContent.trim()}
        style={{
          padding: '10px 20px',
          borderRadius: 6,
          border: 'none',
          background: busy ? 'var(--border)' : 'var(--accent)',
          color: '#fff',
          fontSize: 15,
          fontWeight: 600,
          cursor: busy ? 'not-allowed' : 'pointer',
          alignSelf: 'flex-start',
        }}
      >
        {busy ? 'Analyzing...' : 'Scan for Privacy & Injection Risks'}
      </button>
    </form>
  )
}
