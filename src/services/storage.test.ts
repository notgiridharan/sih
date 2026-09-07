import { describe, it, expect, beforeEach } from 'vitest'
import { saveScan, getScan, getScans, deleteScan, clearScans, getScanCount, MAX_SCANS, SENTINEL_STORAGE_VERSION } from './storage'
import type { ScanResult } from '../types/scan'

function makeScan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    id: overrides.id ?? `scan-${Math.random().toString(36).slice(2)}`,
    url: 'https://example.com',
    timestamp: Date.now(),
    piiMatches: [],
    promptInjections: [],
    hiddenContent: [],
    crossValidation: null,
    ocrResult: null,
    correlationResult: null,
    risk: { overall: 'none', privacy: 0, injection: 0, hidden: 0, visualAnomaly: 0 },
    riskAssessment: null,
    findings: [],
    sanitizedContext: null,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('storage service', () => {
  it('saves and retrieves a scan', () => {
    const scan = makeScan({ id: 'test-1' })
    const result = saveScan(scan)
    expect(result.success).toBe(true)
    const retrieved = getScan('test-1')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe('test-1')
    expect(retrieved!.url).toBe('https://example.com')
  })

  it('retrieves multiple scans in order', () => {
    saveScan(makeScan({ id: 's1', timestamp: 1000 }))
    saveScan(makeScan({ id: 's2', timestamp: 2000 }))
    saveScan(makeScan({ id: 's3', timestamp: 3000 }))
    const scans = getScans()
    expect(scans).toHaveLength(3)
    expect(scans[0].id).toBe('s3')
    expect(scans[2].id).toBe('s1')
  })

  it('deletes a scan', () => {
    saveScan(makeScan({ id: 'del-1' }))
    saveScan(makeScan({ id: 'del-2' }))
    expect(getScans()).toHaveLength(2)
    const deleted = deleteScan('del-1')
    expect(deleted).toBe(true)
    expect(getScans()).toHaveLength(1)
    expect(getScan('del-1')).toBeNull()
    expect(getScan('del-2')).not.toBeNull()
  })

  it('clears all history', () => {
    saveScan(makeScan({ id: 'c1' }))
    saveScan(makeScan({ id: 'c2' }))
    expect(getScanCount()).toBe(2)
    const cleared = clearScans()
    expect(cleared).toBe(true)
    expect(getScans()).toHaveLength(0)
    expect(getScanCount()).toBe(0)
  })

  it('enforces maximum scan limit', () => {
    for (let i = 0; i < MAX_SCANS + 10; i++) {
      saveScan(makeScan({ id: `limit-${i}`, timestamp: i }))
    }
    expect(getScanCount()).toBe(MAX_SCANS)
  })

  it('removes oldest scans first when limit reached', () => {
    for (let i = 0; i < MAX_SCANS + 5; i++) {
      saveScan(makeScan({ id: `order-${i}`, timestamp: i }))
    }
    const scans = getScans()
    expect(scans).toHaveLength(MAX_SCANS)
    expect(getScan('order-0')).toBeNull()
    expect(getScan('order-1')).toBeNull()
    expect(getScan(`order-${MAX_SCANS + 4}`)).not.toBeNull()
  })

  it('handles storage errors gracefully', () => {
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('QuotaExceededError') }
    const result = saveScan(makeScan({ id: 'err-1' }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('QuotaExceededError')
    Storage.prototype.setItem = originalSetItem
  })

  it('handles corrupted data gracefully', () => {
    localStorage.setItem('sentinel-lens-scans', '{not-valid-json')
    const scans = getScans()
    expect(scans).toHaveLength(0)
    expect(getScanCount()).toBe(0)
  })

  it('handles missing data fields gracefully', () => {
    localStorage.setItem('sentinel-lens-scans', JSON.stringify([
      { version: 1, data: { id: 'partial', url: 'https://test.com' } },
      'not-an-object',
      null,
    ]))
    const scans = getScans()
    expect(scans).toHaveLength(1)
    expect(scans[0].id).toBe('partial')
  })

  it('stores scans with version number', () => {
    saveScan(makeScan({ id: 'ver-1' }))
    const raw = localStorage.getItem('sentinel-lens-scans')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed[0].version).toBe(SENTINEL_STORAGE_VERSION)
  })
})
