import { useState, useCallback } from 'react'
import type { ScanResult } from '../types/scan'

const STORAGE_KEY = 'privacy-agent-scan-history'

function loadHistory(): ScanResult[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHistory(history: ScanResult[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch {
    // storage full or unavailable
  }
}

export function useScanHistory() {
  const [history, setHistory] = useState<ScanResult[]>(loadHistory)

  const addResult = useCallback((result: ScanResult) => {
    setHistory((prev) => {
      const next = [result, ...prev].slice(0, 50)
      saveHistory(next)
      return next
    })
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* */ }
  }, [])

  return { history, addResult, clearHistory }
}
