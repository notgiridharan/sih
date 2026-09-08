/**
 * Unit tests for QwenLLMProvider and its helpers.
 *
 * All tests mock @mlc-ai/web-llm so they run in jsdom without WebGPU.
 * Three test-group structures:
 *
 *   1. parseModelOutput — pure function, no mock needed
 *   2. QwenLLMProvider with WebGPU unavailable (no-mock path; navigator.gpu absent)
 *   3. QwenLLMProvider with working mock engine
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SYSTEM_PROMPT, buildUserPrompt, parseModelOutput, QWEN3_MODEL_ID } from './qwen-planner'
import type { LLMRequest } from '../types/agent'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    prompt: 'Login to the portal',
    sanitizedContext: '## Forms\n  Form: POST /login\n    [email] username\n## Available Actions\n  [Button] Sign In\n## Navigation Links\n  [Login] → /login',
    pageUrl: 'https://example.com',
    pageTitle: 'Example Portal',
    availableActions: ['navigate', 'click', 'fill', 'type', 'focus', 'wait'],
    redactionSummary: { totalRedacted: 2, categories: { email: 1, name: 1 } },
    ...overrides,
  }
}

// ─── 1. parseModelOutput (pure, no model) ─────────────────────────────────────

describe('parseModelOutput', () => {
  it('returns a plan with an id and valid structure', () => {
    const plan = parseModelOutput({
      reasoning: 'Navigate then fill',
      riskLevel: 'medium',
      steps: [
        { stepNumber: 1, type: 'navigate', selector: null, value: '/login', description: 'Go to login', requiresApproval: false, dependsOn: [] },
        { stepNumber: 2, type: 'fill', selector: 'input[name="email"]', value: null, description: 'Fill email', requiresApproval: true, dependsOn: [1] },
      ],
    }, makeRequest())

    expect(plan.id).toBeTruthy()
    expect(plan.steps).toHaveLength(2)
    expect(plan.reasoning).toBe('Navigate then fill')
    expect(plan.riskLevel).toBe('medium')
  })

  it('step numbers are sequential starting from 1 regardless of model output', () => {
    const plan = parseModelOutput({
      steps: [
        { stepNumber: 99, type: 'navigate', description: 'a', dependsOn: [] },
        { stepNumber: 42, type: 'click', description: 'b', dependsOn: [] },
      ],
    }, makeRequest())

    expect(plan.steps[0].stepNumber).toBe(1)
    expect(plan.steps[1].stepNumber).toBe(2)
  })

  it('all actions have safe=true unconditionally', () => {
    const plan = parseModelOutput({
      steps: [
        { type: 'navigate', description: 'nav', dependsOn: [] },
        { type: 'fill',     description: 'fill', selector: 'input', dependsOn: [1] },
        { type: 'click',    description: 'click', dependsOn: [2] },
      ],
    }, makeRequest())

    for (const step of plan.steps) {
      expect(step.action.safe).toBe(true)
    }
  })

  it('fill actions always have requiresApproval=true even if model says false', () => {
    const plan = parseModelOutput({
      steps: [
        { type: 'fill', selector: 'input', description: 'fill it', requiresApproval: false, dependsOn: [] },
      ],
    }, makeRequest())

    expect(plan.steps[0].action.requiresApproval).toBe(true)
  })

  it('unknown action types are coerced to "wait"', () => {
    const plan = parseModelOutput({
      steps: [
        { type: 'teleport', description: 'unknown action', dependsOn: [] },
        { type: 123,        description: 'numeric type',   dependsOn: [] },
        { type: null,       description: 'null type',      dependsOn: [] },
      ],
    }, makeRequest())

    for (const step of plan.steps) {
      expect(step.action.type).toBe('wait')
    }
  })

  it('dependsOn only keeps valid prior step numbers', () => {
    const plan = parseModelOutput({
      steps: [
        { type: 'navigate', description: 'step1', dependsOn: [] },
        { type: 'click',    description: 'step2', dependsOn: [1, 99, -1, 2] }, // 99 and 2 invalid (2=self)
      ],
    }, makeRequest())

    expect(plan.steps[1].dependsOn).toEqual([1])
  })

  it('unknown riskLevel is coerced to "low"', () => {
    const plan = parseModelOutput({ riskLevel: 'extreme', steps: [] }, makeRequest())
    expect(plan.riskLevel).toBe('low')
  })

  it('accepts valid riskLevels', () => {
    for (const level of ['low', 'medium', 'high', 'critical'] as const) {
      const plan = parseModelOutput({ riskLevel: level, steps: [] }, makeRequest())
      expect(plan.riskLevel).toBe(level)
    }
  })

  it('produces at least one step even for empty steps array', () => {
    const plan = parseModelOutput({ steps: [] }, makeRequest())
    expect(plan.steps.length).toBeGreaterThanOrEqual(1)
    expect(plan.steps[0].action.type).toBe('wait')
  })

  it('produces at least one step when steps is not an array', () => {
    const plan = parseModelOutput({ steps: 'oops' as unknown as [] }, makeRequest())
    expect(plan.steps.length).toBeGreaterThanOrEqual(1)
  })

  it('includes redaction warning when PII was redacted', () => {
    const plan = parseModelOutput({}, makeRequest({ redactionSummary: { totalRedacted: 5, categories: {} } }))
    expect(plan.warnings.some(w => w.includes('5 sensitive value'))).toBe(true)
  })

  it('omits redaction warning when nothing was redacted', () => {
    const plan = parseModelOutput({}, makeRequest({ redactionSummary: { totalRedacted: 0, categories: {} } }))
    expect(plan.warnings.some(w => w.includes('sensitive value'))).toBe(false)
  })

  it('falls back to a generated reasoning when model reasoning is empty', () => {
    const req = makeRequest({ prompt: 'do the thing' })
    const plan = parseModelOutput({ reasoning: '' }, req)
    expect(plan.reasoning).toContain('do the thing')
  })

  it('populates sanitizationSummary.piiRedacted from request', () => {
    const plan = parseModelOutput({ steps: [] }, makeRequest({ redactionSummary: { totalRedacted: 7, categories: {} } }))
    expect(plan.sanitizationSummary.piiRedacted).toBe(7)
  })

  it('estimatedDurationMs = steps.length * 2000', () => {
    const plan = parseModelOutput({
      steps: [
        { type: 'navigate', description: 'a', dependsOn: [] },
        { type: 'click',    description: 'b', dependsOn: [] },
        { type: 'wait',     description: 'c', dependsOn: [] },
      ],
    }, makeRequest())
    expect(plan.estimatedDurationMs).toBe(3 * 2000)
  })

  it('sets correct timeoutMs per action type', () => {
    const plan = parseModelOutput({
      steps: [
        { type: 'navigate', description: 'nav',  dependsOn: [] },
        { type: 'wait',     description: 'wait', dependsOn: [] },
        { type: 'click',    description: 'click', dependsOn: [] },
      ],
    }, makeRequest())

    expect(plan.steps[0].action.timeoutMs).toBe(10000)  // navigate
    expect(plan.steps[1].action.timeoutMs).toBe(3000)   // wait
    expect(plan.steps[2].action.timeoutMs).toBe(5000)   // everything else
  })

  it('null selector produces null target', () => {
    const plan = parseModelOutput({
      steps: [{ type: 'navigate', selector: null, description: 'nav', dependsOn: [] }],
    }, makeRequest())
    expect(plan.steps[0].action.target).toBeNull()
  })

  it('non-null selector produces ActionTarget with selector field', () => {
    const plan = parseModelOutput({
      steps: [{ type: 'click', selector: 'button#submit', description: 'click', dependsOn: [] }],
    }, makeRequest())
    expect(plan.steps[0].action.target?.selector).toBe('button#submit')
  })

  it('fill step gets rollbackDescription', () => {
    const plan = parseModelOutput({
      steps: [{ type: 'fill', selector: 'input', description: 'fill', dependsOn: [] }],
    }, makeRequest())
    expect(plan.steps[0].rollbackDescription).toBeTruthy()
  })

  it('non-fill step rollbackDescription is null', () => {
    const plan = parseModelOutput({
      steps: [{ type: 'navigate', description: 'nav', dependsOn: [] }],
    }, makeRequest())
    expect(plan.steps[0].rollbackDescription).toBeNull()
  })
})

// ─── 2. Metadata and prompt exports ──────────────────────────────────────────

describe('QWEN3_MODEL_ID and SYSTEM_PROMPT', () => {
  it('model ID matches the MLC prebuilt registry entry', () => {
    expect(QWEN3_MODEL_ID).toBe('Qwen3-0.6B-q4f16_1-MLC')
  })

  it('SYSTEM_PROMPT contains all allowed action types', () => {
    for (const t of ['navigate', 'click', 'fill', 'type', 'focus', 'wait', 'scroll', 'select', 'send_keys', 'go_back']) {
      expect(SYSTEM_PROMPT).toContain(t)
    }
  })

  it('SYSTEM_PROMPT mandates requiresApproval for fill', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('fill')
    expect(SYSTEM_PROMPT).toContain('requiresApproval: true')
  })

  it('SYSTEM_PROMPT instructs JSON-only output', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('json')
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('output')
  })
})

describe('buildUserPrompt', () => {
  it('includes the task prompt', () => {
    const p = buildUserPrompt(makeRequest({ prompt: 'scroll to the bottom' }))
    expect(p).toContain('scroll to the bottom')
  })

  it('includes the page URL', () => {
    const p = buildUserPrompt(makeRequest({ pageUrl: 'https://test.example.com/page' }))
    expect(p).toContain('https://test.example.com/page')
  })

  it('includes the page title', () => {
    const p = buildUserPrompt(makeRequest({ pageTitle: 'My Dashboard' }))
    expect(p).toContain('My Dashboard')
  })

  it('includes redaction note when PII was redacted', () => {
    const p = buildUserPrompt(makeRequest({ redactionSummary: { totalRedacted: 3, categories: {} } }))
    expect(p).toContain('3 PII value(s)')
  })

  it('omits redaction note when nothing was redacted', () => {
    const p = buildUserPrompt(makeRequest({ redactionSummary: { totalRedacted: 0, categories: {} } }))
    expect(p).not.toContain('PII value(s)')
  })

  it('truncates very long context', () => {
    const longCtx = 'x'.repeat(5000)
    const p = buildUserPrompt(makeRequest({ sanitizedContext: longCtx }))
    expect(p).toContain('truncated')
    // The raw 5000-char string should not appear verbatim
    expect(p.length).toBeLessThan(4000)
  })
})

// ─── 3. QwenLLMProvider — WebGPU unavailable ─────────────────────────────────

// In jsdom navigator.gpu is undefined, so no special mocking needed here.

describe('QwenLLMProvider – WebGPU unavailable', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('generatePlan throws when WebGPU is absent', async () => {
    const { QwenLLMProvider } = await import('./qwen-planner')
    const provider = new QwenLLMProvider()
    await expect(provider.generatePlan(makeRequest())).rejects.toThrow(/WebGPU|unavailable/)
  })

  it('generatePlan never throws a validation error for valid requests', async () => {
    const { QwenLLMProvider } = await import('./qwen-planner')
    const provider = new QwenLLMProvider()
    // Should throw "unavailable", NOT a validation error
    await expect(provider.generatePlan(makeRequest())).rejects.toThrow(/WebGPU|unavailable/)
  })

  it('generatePlan throws validation error for empty prompt (before WebGPU check)', async () => {
    const { QwenLLMProvider } = await import('./qwen-planner')
    const provider = new QwenLLMProvider()
    await expect(
      provider.generatePlan(makeRequest({ prompt: '' }))
    ).rejects.toThrow('validation failed')
  })

  it('has correct metadata', async () => {
    const { QwenLLMProvider } = await import('./qwen-planner')
    const provider = new QwenLLMProvider()
    expect(provider.name).toBe('Qwen3-0.6B')
    expect(provider.isLocal).toBe(true)
  })
})

// ─── 4. QwenLLMProvider — working mock engine ─────────────────────────────────

function makeCompletionResponse(json: object) {
  return {
    choices: [{ message: { content: JSON.stringify(json) } }],
  }
}

const MOCK_LOGIN_JSON = {
  reasoning: 'Navigate to login page then fill credentials',
  riskLevel: 'medium',
  steps: [
    { stepNumber: 1, type: 'navigate', selector: null, value: '/login', description: 'Navigate to login', requiresApproval: false, dependsOn: [] },
    { stepNumber: 2, type: 'fill', selector: 'input[name="email"]', value: null, description: 'Fill email', requiresApproval: true, dependsOn: [1] },
    { stepNumber: 3, type: 'fill', selector: 'input[type="password"]', value: null, description: 'Fill password', requiresApproval: true, dependsOn: [2] },
    { stepNumber: 4, type: 'click', selector: 'button[type="submit"]', value: null, description: 'Submit', requiresApproval: true, dependsOn: [3] },
  ],
}

describe('QwenLLMProvider – mock engine', () => {
  const mockCreate = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    // Simulate WebGPU available
    vi.stubGlobal('navigator', { ...globalThis.navigator, gpu: {} })

    vi.doMock('@mlc-ai/web-llm', () => ({
      CreateMLCEngine: vi.fn().mockResolvedValue({
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      }),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns a valid LLMResponse with plan, reasoning, confidence', async () => {
    mockCreate.mockResolvedValue(makeCompletionResponse(MOCK_LOGIN_JSON))
    const { QwenLLMProvider } = await import('./qwen-planner')
    const provider = new QwenLLMProvider()
    const response = await provider.generatePlan(makeRequest())

    expect(response.plan).toBeDefined()
    expect(response.plan.steps.length).toBeGreaterThan(0)
    expect(response.reasoning).toBeTruthy()
    expect(response.confidence).toBeGreaterThan(0)
    expect(typeof response.processingTimeMs).toBe('number')
  })

  it('plan steps have sequential numbers starting from 1', async () => {
    mockCreate.mockResolvedValue(makeCompletionResponse(MOCK_LOGIN_JSON))
    const { QwenLLMProvider } = await import('./qwen-planner')
    const response = await new QwenLLMProvider().generatePlan(makeRequest())

    response.plan.steps.forEach((step, i) => {
      expect(step.stepNumber).toBe(i + 1)
    })
  })

  it('all actions have safe=true', async () => {
    mockCreate.mockResolvedValue(makeCompletionResponse(MOCK_LOGIN_JSON))
    const { QwenLLMProvider } = await import('./qwen-planner')
    const response = await new QwenLLMProvider().generatePlan(makeRequest())

    for (const step of response.plan.steps) {
      expect(step.action.safe).toBe(true)
    }
  })

  it('fill steps always have requiresApproval=true', async () => {
    mockCreate.mockResolvedValue(makeCompletionResponse(MOCK_LOGIN_JSON))
    const { QwenLLMProvider } = await import('./qwen-planner')
    const response = await new QwenLLMProvider().generatePlan(makeRequest())

    const fills = response.plan.steps.filter(s => s.action.type === 'fill')
    expect(fills.length).toBeGreaterThan(0)
    for (const step of fills) {
      expect(step.action.requiresApproval).toBe(true)
    }
  })

  it('dependsOn references only earlier steps', async () => {
    mockCreate.mockResolvedValue(makeCompletionResponse(MOCK_LOGIN_JSON))
    const { QwenLLMProvider } = await import('./qwen-planner')
    const response = await new QwenLLMProvider().generatePlan(makeRequest())

    for (const step of response.plan.steps) {
      for (const dep of step.dependsOn) {
        expect(dep).toBeLessThan(step.stepNumber)
      }
    }
  })

  it('includes redaction warning in plan.warnings', async () => {
    mockCreate.mockResolvedValue(makeCompletionResponse(MOCK_LOGIN_JSON))
    const { QwenLLMProvider } = await import('./qwen-planner')
    const response = await new QwenLLMProvider().generatePlan(
      makeRequest({ redactionSummary: { totalRedacted: 3, categories: {} } })
    )
    expect(response.warnings.some(w => w.includes('3 sensitive value'))).toBe(true)
  })

  it('handles malformed JSON from model gracefully (produces fallback plan)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{ this is not json }' } }],
    })
    const { QwenLLMProvider } = await import('./qwen-planner')
    const response = await new QwenLLMProvider().generatePlan(makeRequest())

    // Should not throw; should produce at least one step
    expect(response.plan.steps.length).toBeGreaterThanOrEqual(1)
  })

  it('handles empty model output gracefully', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] })
    const { QwenLLMProvider } = await import('./qwen-planner')
    const response = await new QwenLLMProvider().generatePlan(makeRequest())
    expect(response.plan.steps.length).toBeGreaterThanOrEqual(1)
  })

  it('handles model output with no steps array', async () => {
    mockCreate.mockResolvedValue(makeCompletionResponse({ reasoning: 'ok', riskLevel: 'low' }))
    const { QwenLLMProvider } = await import('./qwen-planner')
    const response = await new QwenLLMProvider().generatePlan(makeRequest())
    expect(response.plan.steps.length).toBeGreaterThanOrEqual(1)
  })

  it('confidence is higher for multi-step plans', async () => {
    const multiStep = makeCompletionResponse(MOCK_LOGIN_JSON)
    const singleStep = makeCompletionResponse({ steps: [{ type: 'wait', description: 'wait', dependsOn: [] }] })

    mockCreate
      .mockResolvedValueOnce(multiStep)
      .mockResolvedValueOnce(singleStep)

    const { QwenLLMProvider } = await import('./qwen-planner')
    const r1 = await new QwenLLMProvider().generatePlan(makeRequest())
    const r2 = await new QwenLLMProvider().generatePlan(makeRequest())

    expect(r1.confidence).toBeGreaterThan(r2.confidence)
  })

  it('calls thinking callback with progress messages', async () => {
    mockCreate.mockResolvedValue(makeCompletionResponse(MOCK_LOGIN_JSON))
    const steps: string[] = []
    const { QwenLLMProvider } = await import('./qwen-planner')
    const provider = new QwenLLMProvider({ onThinking: (s) => steps.push(s) })
    await provider.generatePlan(makeRequest())

    expect(steps.length).toBeGreaterThanOrEqual(2)
    expect(steps.some(s => s.toLowerCase().includes('qwen') || s.toLowerCase().includes('load'))).toBe(true)
  })

  it('aborts before inference when signal is already aborted', async () => {
    mockCreate.mockResolvedValue(makeCompletionResponse(MOCK_LOGIN_JSON))
    const { QwenLLMProvider } = await import('./qwen-planner')
    const controller = new AbortController()
    controller.abort()
    const provider = new QwenLLMProvider({ signal: controller.signal })
    await expect(provider.generatePlan(makeRequest())).rejects.toThrow(/Aborted|abort/i)
  })

  it('throws validation error for empty prompt', async () => {
    const { QwenLLMProvider } = await import('./qwen-planner')
    const provider = new QwenLLMProvider()
    await expect(provider.generatePlan(makeRequest({ prompt: '' }))).rejects.toThrow('validation failed')
  })

  it('throws validation error for leaked password field', async () => {
    const { QwenLLMProvider } = await import('./qwen-planner')
    const provider = new QwenLLMProvider()
    const req = makeRequest()
    ;(req as unknown as Record<string, unknown>).password = 'secret'
    await expect(provider.generatePlan(req)).rejects.toThrow('validation failed')
  })

  it('only produces allowed action types', async () => {
    const allowed = new Set(['navigate', 'click', 'fill', 'type', 'focus', 'wait', 'scroll', 'select', 'send_keys', 'go_back'])
    // Model returns a mix of valid + invalid types
    mockCreate.mockResolvedValue(makeCompletionResponse({
      steps: [
        { type: 'navigate',  description: 'a', dependsOn: [] },
        { type: 'HAXXX',    description: 'b', dependsOn: [] },
        { type: 'fill',      selector: 'x', description: 'c', dependsOn: [] },
        { type: 'eval_js',   description: 'd', dependsOn: [] },
      ],
    }))
    const { QwenLLMProvider } = await import('./qwen-planner')
    const response = await new QwenLLMProvider().generatePlan(makeRequest())

    for (const step of response.plan.steps) {
      expect(allowed.has(step.action.type)).toBe(true)
    }
  })
})

// ─── 5. createLLMProvider factory ────────────────────────────────────────────

describe('createLLMProvider – qwen', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('navigator', { ...globalThis.navigator, gpu: {} })

    vi.doMock('@mlc-ai/web-llm', () => ({
      CreateMLCEngine: vi.fn().mockResolvedValue({
        chat: { completions: { create: vi.fn().mockResolvedValue(makeCompletionResponse(MOCK_LOGIN_JSON)) } },
      }),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('createLLMProvider("qwen") returns a QwenLLMProvider', async () => {
    const { createLLMProvider } = await import('./llm-service')
    const provider = createLLMProvider('qwen')
    expect(provider.name).toBe('Qwen3-0.6B')
    expect(provider.isLocal).toBe(true)
  })

  it('createLLMProvider("mock") still works', async () => {
    const { createLLMProvider } = await import('./llm-service')
    const provider = createLLMProvider('mock')
    expect(provider.name).toBe('MockLLM')
  })

  it('createLLMProvider with unknown type still throws', async () => {
    const { createLLMProvider } = await import('./llm-service')
    expect(() => createLLMProvider('unknown' as 'mock')).toThrow('Unknown LLM provider')
  })
})
