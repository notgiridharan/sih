import type {
  Action,
  ActionExecutionResult,
  ActionPlan,
  ActionPlanStep,
  ActionStatus,
} from '../types/agent'
import { validateActionSafety } from './action-safety-validator'
import type { ActionValidationResult } from './action-safety-validator'

// --- Execution results ---

export const SUBMISSION_REQUIRES_USER_APPROVAL = 'SUBMISSION_REQUIRES_USER_APPROVAL' as const

export interface ExecutionRecord {
  stepNumber: number
  action: Action
  validation: ActionValidationResult
  result: ActionExecutionResult
}

export interface PlanExecutionResult {
  planId: string
  records: ExecutionRecord[]
  status: 'completed' | 'failed' | 'cancelled' | 'blocked'
  stoppedAt: number | null
  stoppedReason: string | null
}

export type ExecutionListener = (record: ExecutionRecord) => void

// --- DOM bridge interface ---

export interface DOMOperationResult {
  success: boolean
  error: string | null
  detail: string | null
}

export interface DOMBridge {
  click(selector: string): Promise<DOMOperationResult>
  focus(selector: string): Promise<DOMOperationResult>
  type(selector: string, text: string): Promise<DOMOperationResult>
  fill(selector: string, value: string): Promise<DOMOperationResult>
  navigate(url: string): Promise<DOMOperationResult>
  elementExists(selector: string): Promise<boolean>
  getElementAttribute(selector: string, attr: string): Promise<string | null>
  isPasswordField(selector: string): Promise<boolean>
}

// --- Mock DOM bridge (for testing, no real browser interaction) ---

export class MockDOMBridge implements DOMBridge {
  readonly log: { method: string; args: unknown[] }[] = []

  async click(selector: string): Promise<DOMOperationResult> {
    this.log.push({ method: 'click', args: [selector] })
    return { success: true, error: null, detail: `Clicked ${selector}` }
  }

  async focus(selector: string): Promise<DOMOperationResult> {
    this.log.push({ method: 'focus', args: [selector] })
    return { success: true, error: null, detail: `Focused ${selector}` }
  }

  async type(selector: string, text: string): Promise<DOMOperationResult> {
    this.log.push({ method: 'type', args: [selector, text] })
    return { success: true, error: null, detail: `Typed into ${selector}` }
  }

  async fill(selector: string, value: string): Promise<DOMOperationResult> {
    this.log.push({ method: 'fill', args: [selector, value] })
    return { success: true, error: null, detail: `Filled ${selector}` }
  }

  async navigate(url: string): Promise<DOMOperationResult> {
    this.log.push({ method: 'navigate', args: [url] })
    return { success: true, error: null, detail: `Navigated to ${url}` }
  }

  async elementExists(selector: string): Promise<boolean> {
    this.log.push({ method: 'elementExists', args: [selector] })
    return true
  }

  async getElementAttribute(selector: string, attr: string): Promise<string | null> {
    this.log.push({ method: 'getElementAttribute', args: [selector, attr] })
    return null
  }

  async isPasswordField(selector: string): Promise<boolean> {
    this.log.push({ method: 'isPasswordField', args: [selector] })
    return selector.includes('password')
  }
}

// --- Failing bridge (simulates errors for testing) ---

export class FailingDOMBridge extends MockDOMBridge {
  override async click(): Promise<DOMOperationResult> {
    return { success: false, error: 'Element not found', detail: null }
  }
  override async fill(): Promise<DOMOperationResult> {
    return { success: false, error: 'Element not interactable', detail: null }
  }
}

// --- Form submission detection ---

function isFormSubmitAction(action: Action): boolean {
  if (action.type !== 'click') return false
  if (!action.target) return false

  const tag = action.target.tag.toLowerCase()
  const attrs = action.target.attributes
  const selector = action.target.selector.toLowerCase()
  const desc = action.target.description.toLowerCase()

  if (tag === 'input' && attrs['type'] === 'submit') return true
  if (tag === 'button' && (attrs['type'] === 'submit' || !attrs['type'])) {
    if (isInsideForm(selector, desc)) return true
  }
  if (selector.includes('form') && selector.includes('submit')) return true
  if (/submit\s*(form|application|registration|payment)/i.test(desc)) return true

  return false
}

function isInsideForm(selector: string, description: string): boolean {
  return selector.includes('form') || description.includes('form') || description.includes('submit')
}

function isSensitiveFormSubmit(action: Action, records: ExecutionRecord[]): boolean {
  if (!isFormSubmitAction(action)) return false

  const hasFillOrType = records.some(
    r => (r.action.type === 'fill' || r.action.type === 'type')
      && r.result.status === 'completed',
  )
  return hasFillOrType
}

// --- Password field detection ---

function isPasswordAction(action: Action): boolean {
  if (!action.target) return false
  const attrs = action.target.attributes
  if (attrs['type'] === 'password') return true
  const nameOrId = (attrs['name'] ?? '') + (attrs['id'] ?? '')
  if (/password|passwd|pwd/i.test(nameOrId)) return true
  if (action.target.selector.includes('[type="password"]')) return true
  return false
}

function hasUserProvidedSource(action: Action): boolean {
  return action.target?.attributes['data-value-source'] === 'user-provided'
}

// --- Timeout helper ---

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal: AbortSignal | null,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Action timed out after ${ms}ms`)), ms)

    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal?.aborted) { onAbort(); return }
    signal?.addEventListener('abort', onAbort, { once: true })

    promise.then(
      (val) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(val) },
      (err) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(err) },
    )
  })
}

// --- Result builder ---

function makeResult(
  actionId: string,
  status: ActionStatus,
  startedAt: number,
  error: string | null = null,
  detail: string | null = null,
): ActionExecutionResult {
  return {
    actionId,
    status,
    startedAt,
    completedAt: Date.now(),
    error,
    detail,
  }
}

// --- ActionExecutor ---

export interface ActionExecutorOptions {
  bridge: DOMBridge
  signal?: AbortSignal
  approvedSteps?: Set<number>
}

export class ActionExecutor {
  private bridge: DOMBridge
  private signal: AbortSignal | null
  private approvedSteps: Set<number>
  private records: ExecutionRecord[] = []
  private listeners: ExecutionListener[] = []

  constructor(opts: ActionExecutorOptions) {
    this.bridge = opts.bridge
    this.signal = opts.signal ?? null
    this.approvedSteps = opts.approvedSteps ?? new Set()
  }

  onExecution(listener: ExecutionListener): () => void {
    this.listeners.push(listener)
    return () => { this.listeners = this.listeners.filter(l => l !== listener) }
  }

  getRecords(): readonly ExecutionRecord[] {
    return this.records
  }

  async executePlan(plan: ActionPlan): Promise<PlanExecutionResult> {
    this.records = []

    for (const step of plan.steps) {
      this.checkAborted()

      if (!this.areDependenciesMet(step)) {
        const rec = this.buildRecord(step, 'skipped', 'Dependency not met')
        this.records.push(rec)
        this.emit(rec)
        continue
      }

      const rec = await this.executeStep(step)
      this.records.push(rec)
      this.emit(rec)

      if (rec.result.status === 'failed') {
        return {
          planId: plan.id,
          records: [...this.records],
          status: 'failed',
          stoppedAt: Date.now(),
          stoppedReason: rec.result.error,
        }
      }

      if (rec.result.detail === SUBMISSION_REQUIRES_USER_APPROVAL) {
        return {
          planId: plan.id,
          records: [...this.records],
          status: 'blocked',
          stoppedAt: Date.now(),
          stoppedReason: SUBMISSION_REQUIRES_USER_APPROVAL,
        }
      }
    }

    return {
      planId: plan.id,
      records: [...this.records],
      status: 'completed',
      stoppedAt: null,
      stoppedReason: null,
    }
  }

  async executeStep(step: ActionPlanStep): Promise<ExecutionRecord> {
    const { action } = step
    const startedAt = Date.now()

    const validation = validateActionSafety(action)
    if (!validation.allowed) {
      return {
        stepNumber: step.stepNumber,
        action,
        validation,
        result: makeResult(action.id, 'failed', startedAt, `Blocked by safety validator: ${validation.reason}`),
      }
    }

    if (action.requiresApproval && !this.approvedSteps.has(step.stepNumber)) {
      return {
        stepNumber: step.stepNumber,
        action,
        validation,
        result: makeResult(action.id, 'failed', startedAt, 'Action requires user approval but was not approved'),
      }
    }

    if (isSensitiveFormSubmit(action, this.records)) {
      return {
        stepNumber: step.stepNumber,
        action,
        validation,
        result: makeResult(action.id, 'pending', startedAt, null, SUBMISSION_REQUIRES_USER_APPROVAL),
      }
    }

    if ((action.type === 'fill' || action.type === 'type') && isPasswordAction(action)) {
      if (!hasUserProvidedSource(action)) {
        return {
          stepNumber: step.stepNumber,
          action,
          validation: { allowed: false, reason: 'Password field requires user-provided value', riskLevel: 'critical' },
          result: makeResult(action.id, 'failed', startedAt, 'Password field value must be explicitly user-provided'),
        }
      }
    }

    try {
      const domResult = await withTimeout(
        this.dispatchAction(action),
        action.timeoutMs,
        this.signal,
      )

      const status: ActionStatus = domResult.success ? 'completed' : 'failed'
      return {
        stepNumber: step.stepNumber,
        action,
        validation,
        result: makeResult(action.id, status, startedAt, domResult.error, domResult.detail),
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err
      }
      const msg = err instanceof Error ? err.message : 'Unknown execution error'
      return {
        stepNumber: step.stepNumber,
        action,
        validation,
        result: makeResult(action.id, 'failed', startedAt, msg),
      }
    }
  }

  private async dispatchAction(action: Action): Promise<DOMOperationResult> {
    switch (action.type) {
      case 'click':
        return this.bridge.click(action.target!.selector)
      case 'focus':
        return this.bridge.focus(action.target!.selector)
      case 'type':
        return this.bridge.type(action.target!.selector, action.value ?? '')
      case 'fill':
        return this.bridge.fill(action.target!.selector, action.value ?? '')
      case 'navigate':
        return this.bridge.navigate(action.value!)
      case 'wait':
        return this.executeWait(action)
      default:
        return { success: false, error: `Unsupported action type: ${action.type}`, detail: null }
    }
  }

  private async executeWait(action: Action): Promise<DOMOperationResult> {
    const ms = action.timeoutMs
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, Math.min(ms, 10000))
      if (this.signal?.aborted) { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); return }
      this.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
    })
    return { success: true, error: null, detail: `Waited ${ms}ms` }
  }

  private areDependenciesMet(step: ActionPlanStep): boolean {
    for (const dep of step.dependsOn) {
      const depRecord = this.records.find(r => r.stepNumber === dep)
      if (!depRecord || depRecord.result.status !== 'completed') return false
    }
    return true
  }

  private buildRecord(step: ActionPlanStep, status: ActionStatus, error: string | null): ExecutionRecord {
    return {
      stepNumber: step.stepNumber,
      action: step.action,
      validation: { allowed: true, reason: 'Not validated (skipped)', riskLevel: 'none' },
      result: makeResult(step.action.id, status, Date.now(), error),
    }
  }

  private emit(record: ExecutionRecord): void {
    for (const listener of this.listeners) {
      try { listener(record) } catch { /* listener errors don't break execution */ }
    }
  }

  private checkAborted(): void {
    if (this.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
  }
}
