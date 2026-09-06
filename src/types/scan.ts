export interface ScanTarget {
  url: string
  dom: string
  screenshot: string | null
}

export interface PIIMatch {
  type: 'email' | 'phone' | 'ssn' | 'credit_card' | 'address' | 'name' | 'custom'
  value: string
  redacted: string
  location: PIILocation
  confidence: number
}

export interface PIILocation {
  source: 'dom' | 'screenshot'
  selector?: string
  textOffset?: { start: number; end: number }
  boundingBox?: { x: number; y: number; width: number; height: number }
}

export interface PromptInjection {
  type: 'direct' | 'indirect' | 'hidden_text' | 'invisible_element' | 'encoded'
  content: string
  location: PIILocation
  severity: 'low' | 'medium' | 'high' | 'critical'
}

export interface HiddenContent {
  element: string
  selector: string
  technique: 'display_none' | 'visibility_hidden' | 'zero_size' | 'offscreen' | 'opacity_zero' | 'overflow_hidden' | 'aria_hidden'
  content: string
}

export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical'

export interface RiskScore {
  overall: RiskLevel
  privacy: number
  injection: number
  hidden: number
}

export interface ScanResult {
  id: string
  url: string
  timestamp: number
  piiMatches: PIIMatch[]
  promptInjections: PromptInjection[]
  hiddenContent: HiddenContent[]
  risk: RiskScore
  sanitizedContext: string | null
}

export type ScanStatus = 'idle' | 'capturing' | 'analyzing' | 'complete' | 'error'
