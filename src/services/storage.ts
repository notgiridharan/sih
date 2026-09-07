import type { ScanResult } from '../types/scan'

const STORAGE_KEY = 'sentinel-lens-scans'
const VERSION_KEY = 'sentinel-lens-version'
const SENTINEL_STORAGE_VERSION = 1
const MAX_SCANS = 100
const MAX_OCR_TEXT_LENGTH = 10_000
const MAX_EVIDENCE_DETAIL_LENGTH = 2_000

export { MAX_SCANS, SENTINEL_STORAGE_VERSION }

export interface StoredScan {
  version: number
  data: ScanResult
}

function getStorage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

function trimOCRResult(result: ScanResult): ScanResult {
  if (!result.ocrResult) return result
  const ocr = result.ocrResult
  if (ocr.text.length <= MAX_OCR_TEXT_LENGTH) return result
  return {
    ...result,
    ocrResult: {
      ...ocr,
      text: ocr.text.slice(0, MAX_OCR_TEXT_LENGTH),
      blocks: ocr.blocks.slice(0, 50),
    },
  }
}

function trimEvidence(result: ScanResult): ScanResult {
  if (!result.findings || result.findings.length === 0) return result
  return {
    ...result,
    findings: result.findings.map(f => ({
      ...f,
      evidence: f.evidence.map(e => ({
        ...e,
        detail: e.detail.length > MAX_EVIDENCE_DETAIL_LENGTH
          ? e.detail.slice(0, MAX_EVIDENCE_DETAIL_LENGTH)
          : e.detail,
      })),
    })),
  }
}

function prepareScan(result: ScanResult): ScanResult {
  let prepared = trimOCRResult(result)
  prepared = trimEvidence(prepared)
  const { sanitizedContext: _sc, ...rest } = prepared
  return { ...rest, sanitizedContext: null }
}

function readAll(storage: Storage): StoredScan[] {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item: unknown): item is StoredScan =>
        typeof item === 'object' && item !== null && 'version' in item && 'data' in item
    )
  } catch {
    return []
  }
}

function writeAll(storage: Storage, scans: StoredScan[]): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(scans))
  storage.setItem(VERSION_KEY, String(SENTINEL_STORAGE_VERSION))
}

export function saveScan(result: ScanResult): { success: boolean; error?: string } {
  const storage = getStorage()
  if (!storage) return { success: false, error: 'Storage unavailable' }

  try {
    const prepared = prepareScan(result)
    const scans = readAll(storage)

    if (scans.some(s => s.data.id === prepared.id)) {
      return { success: true }
    }

    const entry: StoredScan = { version: SENTINEL_STORAGE_VERSION, data: prepared }
    scans.unshift(entry)

    if (scans.length > MAX_SCANS) {
      scans.length = MAX_SCANS
    }

    writeAll(storage, scans)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Storage write failed' }
  }
}

export function getScan(id: string): ScanResult | null {
  const storage = getStorage()
  if (!storage) return null

  try {
    const scans = readAll(storage)
    const found = scans.find(s => s.data.id === id)
    return found?.data ?? null
  } catch {
    return null
  }
}

export function getScans(): ScanResult[] {
  const storage = getStorage()
  if (!storage) return []

  try {
    return readAll(storage).map(s => s.data)
  } catch {
    return []
  }
}

export function deleteScan(id: string): boolean {
  const storage = getStorage()
  if (!storage) return false

  try {
    const scans = readAll(storage)
    const filtered = scans.filter(s => s.data.id !== id)
    if (filtered.length === scans.length) return false
    writeAll(storage, filtered)
    return true
  } catch {
    return false
  }
}

export function clearScans(): boolean {
  const storage = getStorage()
  if (!storage) return false

  try {
    storage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

export function getScanCount(): number {
  const storage = getStorage()
  if (!storage) return 0

  try {
    return readAll(storage).length
  } catch {
    return 0
  }
}
