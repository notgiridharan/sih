import type { ScanResult, RiskLevel } from '../types/scan'

export interface HistoryStats {
  totalScans: number
  criticalCount: number
  highCount: number
  mediumCount: number
  lowCount: number
  noneCount: number
  scansToday: number
  averageRisk: number
  highRiskDomains: number
}

export interface DomainStats {
  hostname: string
  scanCount: number
  highestScore: number
  highestLevel: RiskLevel
  lastScan: number
}

export interface TrendPoint {
  date: string
  avgScore: number
  scanCount: number
}

function riskLevel(scan: ScanResult): RiskLevel {
  return scan.riskAssessment?.level ?? scan.risk.overall
}

function riskScore(scan: ScanResult): number {
  return scan.riskAssessment?.score ?? 0
}

export function extractHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || url
  }
}

export function computeStats(scans: ScanResult[]): HistoryStats {
  if (scans.length === 0) {
    return {
      totalScans: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      noneCount: 0,
      scansToday: 0,
      averageRisk: 0,
      highRiskDomains: 0,
    }
  }

  let criticalCount = 0
  let highCount = 0
  let mediumCount = 0
  let lowCount = 0
  let noneCount = 0
  let totalScore = 0

  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  let scansToday = 0

  const domainHighest = new Map<string, number>()

  for (const scan of scans) {
    const level = riskLevel(scan)
    const score = riskScore(scan)
    totalScore += score

    switch (level) {
      case 'critical': criticalCount++; break
      case 'high': highCount++; break
      case 'medium': mediumCount++; break
      case 'low': lowCount++; break
      default: noneCount++; break
    }

    if (scan.timestamp >= todayStart) scansToday++

    const host = extractHostname(scan.url)
    const existing = domainHighest.get(host) ?? 0
    if (score > existing) domainHighest.set(host, score)
  }

  let highRiskDomains = 0
  for (const score of domainHighest.values()) {
    if (score >= 50) highRiskDomains++
  }

  return {
    totalScans: scans.length,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    noneCount,
    scansToday,
    averageRisk: Math.round(totalScore / scans.length),
    highRiskDomains,
  }
}

export function computeDomainStats(scans: ScanResult[]): DomainStats[] {
  const map = new Map<string, DomainStats>()

  for (const scan of scans) {
    const host = extractHostname(scan.url)
    const score = riskScore(scan)
    const level = riskLevel(scan)
    const existing = map.get(host)

    if (!existing) {
      map.set(host, {
        hostname: host,
        scanCount: 1,
        highestScore: score,
        highestLevel: level,
        lastScan: scan.timestamp,
      })
    } else {
      existing.scanCount++
      if (score > existing.highestScore) {
        existing.highestScore = score
        existing.highestLevel = level
      }
      if (scan.timestamp > existing.lastScan) {
        existing.lastScan = scan.timestamp
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.scanCount - a.scanCount)
}

export function computeTrend(scans: ScanResult[]): TrendPoint[] {
  if (scans.length < 2) return []

  const byDate = new Map<string, { total: number; count: number }>()

  for (const scan of scans) {
    const d = new Date(scan.timestamp)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const entry = byDate.get(key) ?? { total: 0, count: 0 }
    entry.total += riskScore(scan)
    entry.count++
    byDate.set(key, entry)
  }

  if (byDate.size < 2) return []

  const sorted = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)

  return sorted.map(([date, { total, count }]) => ({
    date,
    avgScore: Math.round(total / count),
    scanCount: count,
  }))
}

export function filterScans(
  scans: ScanResult[],
  options: {
    riskLevel?: RiskLevel
    search?: string
    days?: number
  },
): ScanResult[] {
  let filtered = scans

  if (options.riskLevel) {
    filtered = filtered.filter(s => riskLevel(s) === options.riskLevel)
  }

  if (options.search) {
    const q = options.search.toLowerCase()
    filtered = filtered.filter(s => {
      const host = extractHostname(s.url).toLowerCase()
      const url = s.url.toLowerCase()
      return host.includes(q) || url.includes(q)
    })
  }

  if (options.days) {
    const cutoff = Date.now() - options.days * 86_400_000
    filtered = filtered.filter(s => s.timestamp >= cutoff)
  }

  return filtered
}

export function highestRiskDomains(scans: ScanResult[], limit = 5): DomainStats[] {
  return computeDomainStats(scans)
    .sort((a, b) => b.highestScore - a.highestScore)
    .slice(0, limit)
}

export function mostScannedDomains(scans: ScanResult[], limit = 5): DomainStats[] {
  return computeDomainStats(scans).slice(0, limit)
}
