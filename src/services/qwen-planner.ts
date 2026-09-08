/**
 * Qwen3-0.6B local agent planner via WebLLM (WebGPU).
 *
 * Runs inference entirely in the browser using WebGPU — no data leaves the
 * device after the one-time model download.  The model weights (q4f16_1 INT4,
 * ~380 MB) are cached in the browser's IndexedDB on first use and reused
 * offline thereafter.
 *
 * Requires: WebGPU (Chrome 113+ side panels / popup pages).
 * In environments without WebGPU (service workers, Node.js, jsdom), the
 * provider throws a clear error so callers can fall back to MockLLMProvider.
 *
 * Model ID: Qwen3-0.6B-q4f16_1-MLC
 *   Architecture: Qwen3 transformer, 28 layers, hidden=1024, GQA
 *   Quantization: INT4 (q4f16_1), context window 4096 tokens
 *   VRAM required: ~1.4 GB (GPU-only, no RAM impact)
 */

import type { MLCEngine } from '@mlc-ai/web-llm'
import type { LLMProvider, ThinkingCallback } from './llm-service'
import type { LLMRequest, LLMResponse, ActionPlan, ActionPlanStep, Action, ActionType } from '../types/agent'
import type { RiskLevel } from '../types/scan'
import { validateRequest } from './llm-service'

// ─── Constants ───────────────────────────────────────────────────────────────

export const QWEN3_MODEL_ID = 'Qwen3-0.6B-q4f16_1-MLC'

/** Max characters of sanitized context forwarded to the model (~400 tokens). */
const MAX_CONTEXT_CHARS = 2000

const ALLOWED_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  'navigate', 'click', 'fill', 'type', 'focus',
  'wait', 'scroll', 'select', 'send_keys', 'go_back',
])

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * System prompt that constrains Qwen3 to produce a valid JSON action plan.
 *
 * WebLLM's JSON mode (response_format: {type:'json_object'}) enforces
 * syntactically valid JSON via grammar sampling, so the model can't produce
 * malformed JSON.  The system prompt governs the schema and safety rules.
 */
export const SYSTEM_PROMPT = `You are Sentinel's browser automation planner. Convert a user task and sanitized page context into a structured JSON action plan.

ALLOWED ACTION TYPES ONLY: navigate, click, fill, type, focus, wait, scroll, select, send_keys, go_back

STRICT RULES:
1. "fill" steps MUST have requiresApproval: true — user supplies sensitive values at runtime
2. Never embed raw credentials, emails, passwords, or PII in value fields
3. dependsOn lists step numbers that must complete before this step starts
4. riskLevel: "low" for navigation/read, "medium" for form fills, "high" for destructive actions
5. selector: null when no specific DOM target is needed

OUTPUT FORMAT — output ONLY this JSON, nothing else:
{
  "reasoning": "one-sentence explanation of the approach",
  "riskLevel": "low",
  "steps": [
    {
      "stepNumber": 1,
      "type": "navigate",
      "selector": null,
      "value": "https://example.com/login",
      "description": "Navigate to the login page",
      "requiresApproval": false,
      "dependsOn": []
    },
    {
      "stepNumber": 2,
      "type": "fill",
      "selector": "input[type='email']",
      "value": null,
      "description": "Fill email — user provides value at runtime",
      "requiresApproval": true,
      "dependsOn": [1]
    },
    {
      "stepNumber": 3,
      "type": "click",
      "selector": "button[type='submit']",
      "value": null,
      "description": "Submit the form",
      "requiresApproval": true,
      "dependsOn": [2]
    }
  ]
}`

// ─── User prompt builder ──────────────────────────────────────────────────────

/** Compact user prompt forwarded to the model for each planning request. */
export function buildUserPrompt(request: LLMRequest): string {
  const ctx = request.sanitizedContext.length > MAX_CONTEXT_CHARS
    ? request.sanitizedContext.slice(0, MAX_CONTEXT_CHARS) + '\n[...context truncated...]'
    : request.sanitizedContext

  const redactionNote = request.redactionSummary.totalRedacted > 0
    ? `Note: ${request.redactionSummary.totalRedacted} PII value(s) were redacted from the page context before this analysis.\n`
    : ''

  return `Task: ${request.prompt}
Page URL: ${request.pageUrl}
Page title: ${request.pageTitle}
${redactionNote}
Page context (sanitized):
${ctx}

Generate the JSON action plan now.`
}

// ─── Output parser ────────────────────────────────────────────────────────────

interface RawStep {
  stepNumber?: unknown
  type?: unknown
  selector?: unknown
  value?: unknown
  description?: unknown
  requiresApproval?: unknown
  dependsOn?: unknown
}

interface RawOutput {
  reasoning?: unknown
  riskLevel?: unknown
  steps?: unknown
}

function coerceActionType(t: unknown): ActionType {
  if (typeof t === 'string' && ALLOWED_TYPES.has(t as ActionType)) return t as ActionType
  return 'wait'
}

function coerceRiskLevel(r: unknown): RiskLevel {
  if (r === 'low' || r === 'medium' || r === 'high' || r === 'critical') return r
  return 'low'
}

/**
 * Convert the raw JSON the model emitted into a fully-valid ActionPlan.
 *
 * Post-processing enforces all invariants regardless of model output:
 *   - step numbers are sequential starting from 1
 *   - dependsOn only references earlier steps
 *   - fill actions always have requiresApproval=true
 *   - every action has safe=true
 *   - unknown action types are coerced to 'wait'
 *   - an empty steps array produces a single 'wait' step
 */
export function parseModelOutput(raw: RawOutput, request: LLMRequest): ActionPlan {
  const rawSteps = Array.isArray(raw.steps) ? raw.steps as unknown[] : []

  const reasoning =
    typeof raw.reasoning === 'string' && raw.reasoning.trim()
      ? raw.reasoning.trim()
      : `Qwen3 plan for: "${request.prompt}"`

  const riskLevel = coerceRiskLevel(raw.riskLevel)

  const steps: ActionPlanStep[] = rawSteps.map((rs, idx) => {
    const s = (typeof rs === 'object' && rs !== null ? rs : {}) as RawStep
    const stepNumber   = idx + 1   // always re-sequence to guarantee 1-based ordering
    const type         = coerceActionType(s.type)
    const selector     = typeof s.selector === 'string' && s.selector ? s.selector : null
    const value        = typeof s.value    === 'string' && s.value    ? s.value    : null
    const description  = typeof s.description === 'string' && s.description
      ? s.description
      : `Step ${stepNumber}: ${type}`

    // Security invariant: fill MUST require approval regardless of model output
    const requiresApproval = type === 'fill' || s.requiresApproval === true

    const rawDeps = Array.isArray(s.dependsOn) ? s.dependsOn as unknown[] : []
    const dependsOn = rawDeps
      .map(d => Number(d))
      .filter(d => Number.isInteger(d) && d >= 1 && d < stepNumber)   // only prior steps

    const action: Action = {
      id: crypto.randomUUID(),
      type,
      target: selector
        ? { selector, tag: 'unknown', description, attributes: {} }
        : null,
      value,
      description,
      requiresApproval,
      timeoutMs: type === 'wait' ? 3000 : type === 'navigate' ? 10000 : 5000,
      safe: true,   // enforced unconditionally — model cannot override this
    }

    return {
      stepNumber,
      action,
      explanation: description,
      dependsOn,
      rollbackDescription: type === 'fill'
        ? `Clear the ${selector ?? 'field'}`
        : null,
    } satisfies ActionPlanStep
  })

  // Guarantee at least one step so callers never see an empty plan
  if (steps.length === 0) {
    steps.push({
      stepNumber: 1,
      action: {
        id: crypto.randomUUID(),
        type: 'wait',
        target: null,
        value: '1000',
        description: 'Analyze page structure',
        requiresApproval: false,
        timeoutMs: 3000,
        safe: true,
      },
      explanation: 'Analyzing page structure — Qwen3 produced no steps',
      dependsOn: [],
      rollbackDescription: null,
    })
  }

  const warnings: string[] = []
  if (request.redactionSummary.totalRedacted > 0) {
    warnings.push(
      `${request.redactionSummary.totalRedacted} sensitive value(s) were redacted before analysis`,
    )
  }

  return {
    id: crypto.randomUUID(),
    steps,
    reasoning,
    warnings,
    sanitizationSummary: {
      piiRedacted:          request.redactionSummary.totalRedacted,
      injectionsBlocked:    0,
      hiddenContentRemoved: 0,
    },
    estimatedDurationMs: steps.length * 2000,
    riskLevel,
  }
}

// ─── Engine singleton ─────────────────────────────────────────────────────────

let _engine:        MLCEngine | null = null
let _enginePromise: Promise<MLCEngine | null> | null = null

async function loadEngine(onProgress?: (msg: string) => void): Promise<MLCEngine | null> {
  // WebGPU is only available in browser rendering contexts, not in service
  // workers, Node.js, or jsdom.  Fail fast so the caller can fall back.
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    console.warn('[Sentinel Qwen3] WebGPU unavailable — Qwen3 planner disabled')
    return null
  }

  try {
    // Dynamic import keeps the heavy @mlc-ai/web-llm bundle out of service-
    // worker build paths that don't need it.
    const { CreateMLCEngine } = await import('@mlc-ai/web-llm')

    const e = await CreateMLCEngine(QWEN3_MODEL_ID, {
      initProgressCallback: (progress) => {
        onProgress?.(progress.text ?? 'Loading Qwen3-0.6B...')
      },
    })

    _engine = e
    return e
  } catch (err) {
    console.warn('[Sentinel Qwen3] Engine load failed:', (err as Error).message)
    return null
  }
}

/**
 * Pre-load the Qwen3-0.6B engine.  Safe to call multiple times — returns the
 * cached promise after the first call.  Resolves null when WebGPU is absent.
 *
 * @param onProgress  Optional callback for download/init progress messages.
 */
export function initQwen(onProgress?: (msg: string) => void): Promise<MLCEngine | null> {
  if (!_enginePromise) _enginePromise = loadEngine(onProgress)
  return _enginePromise
}

// ─── QwenLLMProvider ─────────────────────────────────────────────────────────

/**
 * Real Qwen3-0.6B planner.  Implements the same LLMProvider interface as
 * MockLLMProvider so it is a drop-in replacement in the factory.
 */
export class QwenLLMProvider implements LLMProvider {
  readonly name    = 'Qwen3-0.6B'
  readonly isLocal = true

  private readonly onThinking: ThinkingCallback | null
  private readonly signal:     AbortSignal | null

  constructor(opts: { onThinking?: ThinkingCallback; signal?: AbortSignal } = {}) {
    this.onThinking = opts.onThinking ?? null
    this.signal     = opts.signal     ?? null
  }

  async generatePlan(request: LLMRequest): Promise<LLMResponse> {
    const startTime = performance.now()

    const validationError = validateRequest(request)
    if (validationError) throw new Error(`LLM request validation failed: ${validationError}`)

    if (this.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // ── 1. Ensure the engine is loaded ──────────────────────────────────────
    this.onThinking?.('Loading Qwen3-0.6B model...')

    const e = _engine
      ?? (_enginePromise
            ? await _enginePromise
            : await initQwen(msg => this.onThinking?.(msg)))

    if (!e) {
      throw new Error(
        'Qwen3-0.6B unavailable: WebGPU is not supported in this context, or the model failed to load. ' +
        'Use createLLMProvider("mock") for environments without WebGPU.',
      )
    }

    if (this.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // ── 2. Build prompt ──────────────────────────────────────────────────────
    this.onThinking?.('Analyzing task and page context...')
    const userPrompt = buildUserPrompt(request)

    // ── 3. Run inference ─────────────────────────────────────────────────────
    this.onThinking?.('Generating action plan with Qwen3...')

    const completion = await e.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
      response_format: { type: 'json_object' },   // grammar-sampled JSON
      temperature: 0.1,                            // near-deterministic for reliability
      max_tokens: 1024,
    })

    if (this.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // ── 4. Parse + validate output ───────────────────────────────────────────
    this.onThinking?.('Parsing and validating plan...')

    const text = completion.choices[0]?.message?.content ?? ''
    let raw: RawOutput = {}
    try {
      raw = JSON.parse(text) as RawOutput
    } catch {
      console.warn('[Sentinel Qwen3] JSON parse failed on model output:', text.slice(0, 200))
    }

    const plan = parseModelOutput(raw, request)
    const processingTimeMs = Math.round(performance.now() - startTime)

    return {
      plan,
      reasoning:        plan.reasoning,
      confidence:       plan.steps.length > 1 ? 0.82 : 0.55,
      warnings:         plan.warnings,
      processingTimeMs,
    }
  }
}
