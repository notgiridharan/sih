import type { PIIMatch, PIICategory, RiskLevel, ScanResult } from './scan'

// --- Action types ---

export type ActionType = 'navigate' | 'click' | 'fill' | 'type' | 'focus' | 'wait' | 'scroll' | 'select' | 'send_keys' | 'go_back' | 'extract'

export interface Action {
  id: string
  type: ActionType
  target: ActionTarget | null
  value: string | null
  description: string
  requiresApproval: boolean
  timeoutMs: number
  safe: boolean
}

export interface ActionTarget {
  selector: string
  tag: string
  description: string
  attributes: Record<string, string>
}

export type ActionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface ActionExecutionResult {
  actionId: string
  status: ActionStatus
  startedAt: number
  completedAt: number | null
  error: string | null
  detail: string | null
}

// --- Redaction types ---

export interface Redaction {
  original: string
  placeholder: string
  category: PIICategory
  location: RedactionLocation
}

export interface RedactionLocation {
  selector: string | null
  fieldName: string | null
  textOffset: { start: number; end: number } | null
}

export interface RedactionMapping {
  redactions: Redaction[]
  totalRedacted: number
  categoryCounts: Partial<Record<PIICategory, number>>
}

export interface SensitiveElement {
  selector: string
  tag: string
  fieldType: string | null
  fieldName: string | null
  category: PIICategory
  riskLevel: RiskLevel
  redacted: boolean
}

// --- Sanitized page ---

export interface SanitizedPage {
  url: string
  title: string
  sanitizedDOM: string
  structuredContext: string
  redactionMapping: RedactionMapping
  sensitiveElements: SensitiveElement[]
  scanResult: ScanResult
  capturedAt: number
}

// --- Mock LLM types ---

export interface LLMRequest {
  prompt: string
  sanitizedContext: string
  pageUrl: string
  pageTitle: string
  availableActions: ActionType[]
  redactionSummary: {
    totalRedacted: number
    categories: Partial<Record<PIICategory, number>>
  }
}

export interface LLMResponse {
  plan: ActionPlan
  reasoning: string
  confidence: number
  warnings: string[]
  processingTimeMs: number
}

// --- Action plan ---

export interface ActionPlan {
  id: string
  steps: ActionPlanStep[]
  reasoning: string
  warnings: string[]
  sanitizationSummary: {
    piiRedacted: number
    injectionsBlocked: number
    hiddenContentRemoved: number
  }
  estimatedDurationMs: number
  riskLevel: RiskLevel
}

export interface ActionPlanStep {
  stepNumber: number
  action: Action
  explanation: string
  dependsOn: number[]
  rollbackDescription: string | null
}

// --- Agent execution flow ---

export type AgentPhase =
  | 'idle'
  | 'capturing'
  | 'scanning'
  | 'sanitizing'
  | 'processing-prompt'
  | 'awaiting-approval'
  | 'executing'
  | 'completed'
  | 'error'
  | 'cancelled'

export interface AgentStep {
  id: string
  phase: AgentPhase
  label: string
  detail: string | null
  startedAt: number
  completedAt: number | null
  status: 'active' | 'completed' | 'failed' | 'skipped'
}

export interface AgentState {
  phase: AgentPhase
  steps: AgentStep[]
  currentStepId: string | null
  error: string | null
  sanitizedPage: SanitizedPage | null
  plan: ActionPlan | null
  executionResults: ActionExecutionResult[]
  startedAt: number | null
  completedAt: number | null
}

// --- Prompt ---

export interface AgentPrompt {
  id: string
  text: string
  timestamp: number
  injectionDetected: boolean
  sanitizedText: string
}

// --- Approval ---

export type ApprovalDecision = 'approved' | 'rejected' | 'modified'

export interface ApprovalState {
  planId: string
  decision: ApprovalDecision | null
  decidedAt: number | null
  modifiedSteps: number[]
  rejectionReason: string | null
}

// --- Session ---

export interface AgentSession {
  id: string
  prompt: AgentPrompt
  state: AgentState
  approval: ApprovalState | null
  piiMatches: PIIMatch[]
  createdAt: number
  completedAt: number | null
}
