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

export type AnomalyType =
  | 'HIDDEN_AGENT_INSTRUCTION'
  | 'INVISIBLE_PROMPT_INJECTION'
  | 'OFFSCREEN_SUSPICIOUS_CONTENT'
  | 'DOM_VISIBILITY_MISMATCH'
  | 'HIDDEN_INTERACTIVE_ELEMENT'
  | 'CLOAKED_CONTENT'

export interface CrossValidationAnomaly {
  type: AnomalyType
  severity: RiskLevel
  selector: string
  content: string
  technique: HiddenContent['technique'] | null
  reason: string
}

export interface CrossValidationResult {
  anomalies: CrossValidationAnomaly[]
  hiddenInjectionCount: number
  invisibleContentCount: number
  domVisibilityMismatches: { selector: string; reason: string }[]
  severity: RiskLevel
  hasScreenshot: boolean
}

export interface OCRBlock {
  text: string
  confidence: number
  boundingBox: { x: number; y: number; width: number; height: number }
}

export type OCRStatus = 'idle' | 'loading' | 'processing' | 'complete' | 'error' | 'skipped'

export interface OCRResult {
  text: string
  confidence: number
  blocks: OCRBlock[]
  status: OCRStatus
  error?: string
  processingTimeMs: number
}

export type CorrelationType =
  | 'VISUAL_PII_REQUEST'
  | 'VISUAL_CREDENTIAL_REQUEST'
  | 'VISUAL_OTP_REQUEST'
  | 'VISUAL_PAYMENT_REQUEST'
  | 'CROSS_MODAL_INJECTION'
  | 'VISUAL_DOM_MISMATCH'
  | 'HIDDEN_CONTENT_MISMATCH'

export type CorrelationSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface CorrelationEvidence {
  visual: {
    ocrText: string
    ocrConfidence: number
    boundingBox?: { x: number; y: number; width: number; height: number }
  } | null
  dom: {
    element: string
    selector: string
    matchedText: string
    attributes?: Record<string, string>
  } | null
}

export interface CorrelationFinding {
  type: CorrelationType
  severity: CorrelationSeverity
  confidence: number
  explanation: string
  evidence: CorrelationEvidence
}

export interface CorrelationResult {
  findings: CorrelationFinding[]
  totalCorrelations: number
  highestSeverity: CorrelationSeverity | 'none'
}

export interface RiskScore {
  overall: RiskLevel
  privacy: number
  injection: number
  hidden: number
  visualAnomaly: number
}

export type RiskCategory = 'privacy' | 'injection' | 'deception' | 'overall'

export interface RiskContribution {
  source: string
  category: RiskCategory
  score: number
  severity: RiskLevel
  detail: string
}

export interface RiskAssessment {
  score: number
  level: RiskLevel
  confidence: number
  categories: Record<RiskCategory, { score: number; level: RiskLevel }>
  contributions: RiskContribution[]
  explanation: string
  recommendation: string
}

export type EvidenceSource = 'DOM' | 'OCR' | 'CORRELATION' | 'CROSS_VALIDATION'

export type EvidenceStrength = 'SINGLE_SOURCE' | 'MULTI_SOURCE' | 'CROSS_MODAL'

export interface EvidenceItem {
  source: EvidenceSource
  label: string
  detail: string
  selector?: string
  element?: string
  attributes?: Record<string, string>
  ocrText?: string
  ocrConfidence?: number
  boundingBox?: { x: number; y: number; width: number; height: number }
  visibility?: string
}

export interface SecurityFinding {
  id: string
  title: string
  category: RiskCategory
  severity: RiskLevel
  confidence: number
  description: string
  evidence: EvidenceItem[]
  evidenceStrength: EvidenceStrength
  recommendation: string
}

export interface SecurityReport {
  header: string
  scan: {
    url: string
    hostname: string
    timestamp: number
    id: string
  }
  risk: {
    score: number
    level: RiskLevel
    confidence: number
    categories: Record<RiskCategory, { score: number; level: RiskLevel }>
  }
  findings: SecurityFinding[]
  summary: string
  generatedAt: number
}

export interface ScanResult {
  id: string
  url: string
  timestamp: number
  piiMatches: PIIMatch[]
  promptInjections: PromptInjection[]
  hiddenContent: HiddenContent[]
  crossValidation: CrossValidationResult | null
  ocrResult: OCRResult | null
  correlationResult: CorrelationResult | null
  risk: RiskScore
  riskAssessment: RiskAssessment | null
  findings: SecurityFinding[]
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
