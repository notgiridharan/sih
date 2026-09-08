import type {
  AgentSession,
  AgentState,
  AgentStep,
  AgentPhase,
  AgentPrompt,
  LLMRequest,
} from '../types/agent'
import type { ScanResult } from '../types/scan'
import { scan } from './scanner'
import { sanitize } from './sanitization'
import type { SanitizationOutput } from './sanitization'
import { detectPromptInjections } from './injection-detector'
import { captureActiveTab, isExtension } from './extension-bridge'
import type { LLMProvider } from './llm-service'
import { MockLLMProvider } from './llm-service'
import { validatePlanSafety } from './action-safety-validator'

// --- Progress events ---

export type ProgressEventType =
  | 'phase-change'
  | 'step-start'
  | 'step-complete'
  | 'step-fail'
  | 'thinking'
  | 'plan-ready'
  | 'error'
  | 'cancelled'
  | 'completed'

export interface ProgressEvent {
  type: ProgressEventType
  phase: AgentPhase
  message: string
  timestamp: number
  detail?: string
}

export type ProgressListener = (event: ProgressEvent) => void

// Re-export the safety validator
export { validateStepSafety, validatePlanSafety, validateActionSafety } from './action-safety-validator'

// --- Prompt sanitization ---

export function sanitizePrompt(text: string): AgentPrompt {
  const injections = detectPromptInjections(text)
  const injectionDetected = injections.length > 0

  let sanitizedText = text
  if (injectionDetected) {
    for (const inj of injections) {
      sanitizedText = sanitizedText.replace(inj.content, '[BLOCKED]')
    }
  }

  return {
    id: crypto.randomUUID(),
    text,
    timestamp: Date.now(),
    injectionDetected,
    sanitizedText,
  }
}

// --- Page source ---

export interface PageSource {
  dom: string
  url: string
  title: string
}

export interface PageSourceProvider {
  getPage(): Promise<PageSource>
}

export class ExtensionPageSource implements PageSourceProvider {
  async getPage(): Promise<PageSource> {
    const tab = await captureActiveTab()
    return { dom: tab.dom, url: tab.url, title: tab.title }
  }
}

export class StaticPageSource implements PageSourceProvider {
  private source: PageSource
  constructor(source: PageSource) {
    this.source = source
  }
  async getPage(): Promise<PageSource> {
    return this.source
  }
}

// --- Step builder ---

function makeStep(phase: AgentPhase, label: string, detail: string | null = null): AgentStep {
  return {
    id: crypto.randomUUID(),
    phase,
    label,
    detail,
    startedAt: Date.now(),
    completedAt: null,
    status: 'active',
  }
}

function completeStep(step: AgentStep): AgentStep {
  return { ...step, completedAt: Date.now(), status: 'completed' }
}

// --- PromptProcessor ---

export interface PromptProcessorOptions {
  llmProvider?: LLMProvider
  pageSource?: PageSourceProvider
  latencyMs?: number
  signal?: AbortSignal
}

export class PromptProcessor {
  private llmProvider: LLMProvider
  private pageSource: PageSourceProvider
  private signal: AbortSignal | null
  private listeners: ProgressListener[] = []
  private state: AgentState

  constructor(opts: PromptProcessorOptions = {}) {
    this.signal = opts.signal ?? null
    this.pageSource = opts.pageSource ?? (isExtension()
      ? new ExtensionPageSource()
      : new StaticPageSource({ dom: '', url: 'about:blank', title: '' }))

    this.llmProvider = opts.llmProvider ?? new MockLLMProvider({
      latencyMs: opts.latencyMs ?? 800,
      onThinking: (step) => this.emit('thinking', this.state.phase, step),
      signal: this.signal ?? undefined,
    })

    this.state = createInitialState()
  }

  onProgress(listener: ProgressListener): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  getState(): AgentState {
    return { ...this.state }
  }

  async process(promptText: string): Promise<AgentSession> {
    const sessionId = crypto.randomUUID()
    const startedAt = Date.now()

    this.state = createInitialState()
    this.state.startedAt = startedAt

    try {
      this.checkAborted()

      // 1. Sanitize prompt
      const prompt = sanitizePrompt(promptText)
      if (prompt.injectionDetected) {
        this.emit('thinking', 'idle', 'Injection attempt detected in prompt — blocked')
      }

      // 2. Capture page
      this.transition('capturing', 'Capturing current page...')
      const capStep = makeStep('capturing', 'Capture page DOM')
      this.addStep(capStep)

      const page = await this.pageSource.getPage()
      this.updateStep(capStep.id, completeStep(capStep))

      if (!page.dom || page.dom.trim().length === 0) {
        throw new ProcessorError('No page content available to analyze', 'capturing')
      }

      this.checkAborted()

      // 3. Scan page
      this.transition('scanning', 'Scanning page for privacy risks...')
      const scanStep = makeStep('scanning', 'Privacy & security scan')
      this.addStep(scanStep)

      const scanResult = scan({ url: page.url, dom: page.dom, screenshot: null })
      this.updateStep(scanStep.id, completeStep({
        ...scanStep,
        detail: `Found ${scanResult.piiMatches.length} PII, ${scanResult.promptInjections.length} injections, ${scanResult.hiddenContent.length} hidden`,
      }))

      this.checkAborted()

      // 4. Sanitize
      this.transition('sanitizing', 'Redacting sensitive information...')
      const sanitizeStep = makeStep('sanitizing', 'Sanitize page content')
      this.addStep(sanitizeStep)

      const sanitization = sanitize(page.dom)
      this.updateStep(sanitizeStep.id, completeStep({
        ...sanitizeStep,
        detail: `${sanitization.statistics.totalRedactions} values redacted`,
      }))

      this.state.sanitizedPage = {
        url: page.url,
        title: page.title,
        sanitizedDOM: sanitization.sanitizedContent,
        structuredContext: buildStructuredContextFromScan(scanResult, page.url, page.title),
        redactionMapping: sanitization.mapping,
        sensitiveElements: [],
        scanResult,
        capturedAt: Date.now(),
      }

      this.checkAborted()

      // 5. Generate plan via LLM
      this.transition('processing-prompt', 'Generating action plan...')
      const llmStep = makeStep('processing-prompt', 'Mock LLM reasoning')
      this.addStep(llmStep)

      const llmRequest = buildLLMRequest(prompt, sanitization, scanResult, page)
      assertNoLeakedData(llmRequest, sanitization)

      const llmResponse = await this.llmProvider.generatePlan(llmRequest)
      this.updateStep(llmStep.id, completeStep({
        ...llmStep,
        detail: `${llmResponse.plan.steps.length} actions, confidence ${Math.round(llmResponse.confidence * 100)}%`,
      }))

      this.checkAborted()

      // 6. Validate plan
      const validation = validatePlanSafety(llmResponse.plan)
      if (!validation.allowed) {
        const reasons = validation.results
          .filter(r => !r.result.allowed)
          .map(r => `Step ${r.stepNumber}: ${r.result.reason}`)
          .join('; ')
        throw new ProcessorError(`Plan validation failed: ${reasons}`, 'processing-prompt')
      }

      this.state.plan = llmResponse.plan

      // 7. Await approval
      this.transition('awaiting-approval', 'Action plan ready — awaiting user approval')
      this.emit('plan-ready', 'awaiting-approval', `${llmResponse.plan.steps.length} actions proposed`)

      const session: AgentSession = {
        id: sessionId,
        prompt,
        state: { ...this.state },
        approval: {
          planId: llmResponse.plan.id,
          decision: null,
          decidedAt: null,
          modifiedSteps: [],
          rejectionReason: null,
        },
        piiMatches: scanResult.piiMatches,
        createdAt: startedAt,
        completedAt: null,
      }

      return session
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.transition('cancelled', 'Processing cancelled by user')
        this.emit('cancelled', 'cancelled', 'Processing cancelled')

        return buildErrorSession(
          sessionId, promptText, startedAt, this.state, 'cancelled', 'Processing cancelled by user',
        )
      }

      const message = err instanceof Error ? err.message : 'Unknown error'
      const phase = err instanceof ProcessorError ? err.phase : this.state.phase
      this.transition('error', message)
      this.emit('error', 'error', message)

      return buildErrorSession(sessionId, promptText, startedAt, this.state, phase, message)
    }
  }

  cancel(): void {
    // Callers should abort via the AbortController passed in options
    this.transition('cancelled', 'Cancelled by user')
    this.emit('cancelled', 'cancelled', 'Processing cancelled')
  }

  private transition(phase: AgentPhase, message: string): void {
    this.state.phase = phase
    this.emit('phase-change', phase, message)
  }

  private addStep(step: AgentStep): void {
    this.state.steps = [...this.state.steps, step]
    this.state.currentStepId = step.id
    this.emit('step-start', step.phase, step.label, step.detail ?? undefined)
  }

  private updateStep(id: string, updated: AgentStep): void {
    this.state.steps = this.state.steps.map(s => s.id === id ? updated : s)
    if (updated.status === 'completed') {
      this.emit('step-complete', updated.phase, updated.label, updated.detail ?? undefined)
    } else if (updated.status === 'failed') {
      this.emit('step-fail', updated.phase, updated.label, updated.detail ?? undefined)
    }
  }

  private emit(type: ProgressEventType, phase: AgentPhase, message: string, detail?: string): void {
    const event: ProgressEvent = { type, phase, message, timestamp: Date.now(), detail }
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* listener errors don't break the pipeline */ }
    }
  }

  private checkAborted(): void {
    if (this.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
  }
}

// --- Internal helpers ---

class ProcessorError extends Error {
  phase: AgentPhase
  constructor(message: string, phase: AgentPhase) {
    super(message)
    this.name = 'ProcessorError'
    this.phase = phase
  }
}

function createInitialState(): AgentState {
  return {
    phase: 'idle',
    steps: [],
    currentStepId: null,
    error: null,
    sanitizedPage: null,
    plan: null,
    executionResults: [],
    startedAt: null,
    completedAt: null,
  }
}

function buildStructuredContextFromScan(scanResult: ScanResult, url: string, title: string): string {
  if (scanResult.sanitizedContext) return scanResult.sanitizedContext
  return `# Page: ${title}\n# URL: ${url}\n# PII: ${scanResult.piiMatches.length} | Injections: ${scanResult.promptInjections.length}`
}

function buildLLMRequest(
  prompt: AgentPrompt,
  sanitization: SanitizationOutput,
  scanResult: ScanResult,
  page: PageSource,
): LLMRequest {
  return {
    prompt: prompt.sanitizedText,
    sanitizedContext: scanResult.sanitizedContext ?? sanitization.sanitizedContent,
    pageUrl: page.url,
    pageTitle: page.title,
    availableActions: ['navigate', 'click', 'fill', 'type', 'focus', 'wait'],
    redactionSummary: {
      totalRedacted: sanitization.statistics.totalRedactions,
      categories: sanitization.mapping.categoryCounts,
    },
  }
}

export function assertNoLeakedData(request: LLMRequest, sanitization: SanitizationOutput): void {
  const serialized = JSON.stringify(request)

  for (const redaction of sanitization.redactions) {
    if (redaction.original.startsWith('[') && redaction.original.endsWith(']')) continue
    if (redaction.original.length < 4) continue
    if (serialized.includes(redaction.original)) {
      throw new Error(
        `Data leak detected: original value "${redaction.original.slice(0, 8)}..." found in LLM request`,
      )
    }
  }

  const forbidden = ['"original":', '"password":', '"redactionMapping":', '"mapping":']
  const lower = serialized.toLowerCase()
  for (const keyword of forbidden) {
    if (lower.includes(keyword.toLowerCase())) {
      throw new Error(`LLM request contains forbidden field: ${keyword}`)
    }
  }
}

function buildErrorSession(
  sessionId: string,
  promptText: string,
  startedAt: number,
  state: AgentState,
  phase: AgentPhase,
  errorMessage: string,
): AgentSession {
  return {
    id: sessionId,
    prompt: {
      id: crypto.randomUUID(),
      text: promptText,
      timestamp: startedAt,
      injectionDetected: false,
      sanitizedText: promptText,
    },
    state: {
      ...state,
      phase,
      error: errorMessage,
      completedAt: Date.now(),
    },
    approval: null,
    piiMatches: [],
    createdAt: startedAt,
    completedAt: Date.now(),
  }
}
