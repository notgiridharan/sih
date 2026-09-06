export interface ScanTarget {
  url: string
  dom: string
  screenshot: string | null
}

export type PIICategory =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit_card'
  | 'address'
  | 'name'
  | 'date_of_birth'
  | 'pan'
  | 'aadhaar'
  | 'bank_account'
  | 'upi_id'
  | 'password_field'
  | 'api_key'
  | 'session_id'
  | 'custom'

export interface PIIMatch {
  type: PIICategory
  value: string
  redacted: string
  location: PIILocation
  confidence: number
  risk: RiskLevel
  action: string
  elementTag?: string
  detectedBy: 'regex' | 'heuristic' | 'dom-inspection' | 'ml'
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

export type CaptureStatus = 'idle' | 'capturing' | 'captured' | 'analyzing' | 'complete' | 'error'

export interface DOMNodeInfo {
  tag: string
  id?: string
  classes?: string[]
  childCount: number
  textLength: number
  attributes: Record<string, string>
  children: DOMNodeInfo[]
  hidden: boolean
  depth: number
}

export interface CaptureMetadata {
  title: string
  elementCount: number
  textNodeCount: number
  scriptCount: number
  styleCount: number
  formCount: number
  inputCount: number
  linkCount: number
  imageCount: number
  iframeCount: number
  hiddenElementCount: number
  totalTextLength: number
  doctype: string | null
  charset: string | null
}

export interface CaptureData {
  url: string
  timestamp: number
  dom: string
  screenshot: string | null
  domTree: DOMNodeInfo
  metadata: CaptureMetadata
}

export type ElementCategory =
  | 'input'
  | 'form'
  | 'button'
  | 'link'
  | 'text'
  | 'hidden'
  | 'iframe'
  | 'script'
  | 'interactive'
  | 'media'
  | 'structural'

export interface AnalyzedElement {
  tag: string
  category: ElementCategory
  selector: string
  id?: string
  classes: string[]
  attributes: Record<string, string>
  visible: boolean
  textContent: string
  boundingBox: { x: number; y: number; width: number; height: number } | null
  classification: 'safe' | 'sensitive' | 'suspicious' | 'unclassified'
  children: AnalyzedElement[]
  depth: number
  index: number
}

export interface DOMAnalysisSummary {
  inputs: number
  forms: number
  buttons: number
  links: number
  visibleText: number
  hidden: number
  iframes: number
  scripts: number
  interactive: number
  total: number
}

export interface DOMAnalysis {
  tree: AnalyzedElement
  flatElements: AnalyzedElement[]
  summary: DOMAnalysisSummary
}
