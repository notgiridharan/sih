import { describe, it, expect } from 'vitest'
import { MockLLMProvider, validateRequest, createLLMProvider } from './llm-service'
import type { LLMRequest } from '../types/agent'

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    prompt: 'Login to this portal',
    sanitizedContext: '## Forms\n  Form: POST /login\n    [email] username\n    [password] password\n## Available Actions\n  [Button] Sign In\n## Navigation Links\n  [Login] → /login\n  [Register] → /register',
    pageUrl: 'https://example.com',
    pageTitle: 'Example Portal',
    availableActions: ['navigate', 'click', 'fill', 'type', 'focus', 'wait'],
    redactionSummary: {
      totalRedacted: 3,
      categories: { email: 1, password_field: 1, name: 1 },
    },
    ...overrides,
  }
}

describe('validateRequest', () => {
  it('returns null for a valid request', () => {
    expect(validateRequest(makeRequest())).toBeNull()
  })

  it('rejects empty prompt', () => {
    expect(validateRequest(makeRequest({ prompt: '' }))).toBe('Prompt is required')
  })

  it('rejects whitespace-only prompt', () => {
    expect(validateRequest(makeRequest({ prompt: '   ' }))).toBe('Prompt is required')
  })

  it('rejects empty sanitized context', () => {
    expect(validateRequest(makeRequest({ sanitizedContext: '' }))).toBe('Sanitized context is required')
  })

  it('rejects request containing "original" field', () => {
    const req = makeRequest()
    ;(req as unknown as Record<string, unknown>).original = 'leaked data'
    const result = validateRequest(req)
    expect(result).toContain('original')
  })

  it('rejects request containing "password" field', () => {
    const req = makeRequest()
    ;(req as unknown as Record<string, unknown>).password = 'secret123'
    const result = validateRequest(req)
    expect(result).toContain('password')
  })

  it('rejects request containing "redactionMapping" field', () => {
    const req = makeRequest()
    ;(req as unknown as Record<string, unknown>).redactionMapping = { some: 'data' }
    const result = validateRequest(req)
    expect(result).toContain('redactionmapping')
  })
})

describe('MockLLMProvider', () => {
  it('has correct metadata', () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    expect(provider.name).toBe('MockLLM')
    expect(provider.isLocal).toBe(true)
  })

  it('generates a plan for login scenario', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest({ prompt: 'Login to this portal' }))

    expect(response.plan).toBeDefined()
    expect(response.plan.steps.length).toBeGreaterThan(0)
    expect(response.confidence).toBeGreaterThan(0.5)
    expect(response.processingTimeMs).toBeGreaterThanOrEqual(0)

    const actionTypes = response.plan.steps.map(s => s.action.type)
    expect(actionTypes).toContain('fill')
    expect(actionTypes).toContain('click')

    const fillSteps = response.plan.steps.filter(s => s.action.type === 'fill')
    for (const step of fillSteps) {
      expect(step.action.target?.attributes['data-value-source']).toBe('user-provided')
    }
  })

  it('generates a plan for sign in variant', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest({ prompt: 'Sign in to my account' }))

    expect(response.plan.steps.length).toBeGreaterThan(0)
    expect(response.confidence).toBeGreaterThan(0.5)
  })

  it('generates a plan for fill form scenario', async () => {
    const ctx = '## Forms\n  Form: POST /apply\n    [text] fullname\n    [email] email → [EMAIL_001]\n    [tel] phone → [PHONE_001]\n## Available Actions\n  [Button] Submit Application'
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest({
      prompt: 'Fill this application form',
      sanitizedContext: ctx,
    }))

    expect(response.plan.steps.length).toBeGreaterThan(0)
    const hasSubmit = response.plan.steps.some(s => s.action.type === 'click')
    expect(hasSubmit).toBe(true)
  })

  it('generates a plan for find registration scenario', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest({
      prompt: 'Find the registration form',
    }))

    expect(response.plan.steps.length).toBeGreaterThan(0)
    const hasNav = response.plan.steps.some(s =>
      s.action.type === 'navigate' || s.action.type === 'click'
    )
    expect(hasNav).toBe(true)
  })

  it('generates a plan for navigate to login scenario', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest({
      prompt: 'Navigate to the login page',
    }))

    expect(response.plan.steps.length).toBeGreaterThan(0)
  })

  it('generates a plan for generic navigate scenario', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest({
      prompt: 'Navigate to https://example.com/dashboard',
    }))

    expect(response.plan.steps.length).toBeGreaterThan(0)
    const navStep = response.plan.steps.find(s => s.action.type === 'navigate')
    expect(navStep?.action.value).toContain('https://example.com/dashboard')
  })

  it('generates a plan for click element scenario', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest({
      prompt: 'Click the Submit button',
    }))

    expect(response.plan.steps.length).toBeGreaterThan(0)
    const clickStep = response.plan.steps.find(s => s.action.type === 'click')
    expect(clickStep).toBeDefined()
  })

  it('returns fallback plan for unrecognized prompt', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest({
      prompt: 'Do something completely unknown',
    }))

    expect(response.plan.steps.length).toBeGreaterThan(0)
    expect(response.confidence).toBeLessThan(0.5)
    expect(response.warnings.length).toBeGreaterThan(0)
  })

  it('includes redaction warnings when PII was redacted', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest({
      redactionSummary: { totalRedacted: 5, categories: { email: 2, phone: 3 } },
    }))

    const hasRedactionWarning = response.warnings.some(w => w.includes('5 sensitive value(s)'))
    expect(hasRedactionWarning).toBe(true)
  })

  it('does not include redaction warning when nothing was redacted', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest({
      redactionSummary: { totalRedacted: 0, categories: {} },
    }))

    const hasRedactionWarning = response.warnings.some(w => w.includes('sensitive value'))
    expect(hasRedactionWarning).toBe(false)
  })

  it('calls thinking callback with progress steps', async () => {
    const steps: string[] = []
    const provider = new MockLLMProvider({
      latencyMs: 0,
      onThinking: (step) => steps.push(step),
    })

    await provider.generatePlan(makeRequest())

    expect(steps.length).toBeGreaterThanOrEqual(3)
    expect(steps[0]).toContain('Parsing')
    expect(steps[1]).toContain('Analyzing')
  })

  it('can be aborted via AbortSignal', async () => {
    const controller = new AbortController()
    const provider = new MockLLMProvider({
      latencyMs: 5000,
      signal: controller.signal,
    })

    const promise = provider.generatePlan(makeRequest())
    setTimeout(() => controller.abort(), 10)

    await expect(promise).rejects.toThrow()
  })

  it('throws on invalid request', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    await expect(provider.generatePlan(makeRequest({ prompt: '' }))).rejects.toThrow('validation failed')
  })

  it('never includes raw PII in the response', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest())
    const serialized = JSON.stringify(response)

    expect(serialized).not.toContain('john@example.com')
    expect(serialized).not.toContain('password123')
    expect(serialized).not.toContain('9876543210')
    expect(serialized).not.toContain('secret')
  })

  it('all fill actions have requiresApproval set', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest())

    const fillActions = response.plan.steps
      .filter(s => s.action.type === 'fill')
      .map(s => s.action)

    for (const action of fillActions) {
      expect(action.requiresApproval).toBe(true)
    }
  })

  it('all actions have safe=true', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest())

    for (const step of response.plan.steps) {
      expect(step.action.safe).toBe(true)
    }
  })

  it('only uses allowed action types', async () => {
    const allowedTypes = new Set(['navigate', 'click', 'fill', 'type', 'focus', 'wait'])
    const provider = new MockLLMProvider({ latencyMs: 0 })

    for (const prompt of [
      'Login to this portal',
      'Fill this form securely',
      'Find the registration form',
      'Navigate to the login page',
      'Click the Submit button',
      'Do something unknown',
    ]) {
      const response = await provider.generatePlan(makeRequest({ prompt }))
      for (const step of response.plan.steps) {
        expect(allowedTypes.has(step.action.type)).toBe(true)
      }
    }
  })

  it('step numbers are sequential starting from 1', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest())

    response.plan.steps.forEach((step, i) => {
      expect(step.stepNumber).toBe(i + 1)
    })
  })

  it('dependsOn references only earlier steps', async () => {
    const provider = new MockLLMProvider({ latencyMs: 0 })
    const response = await provider.generatePlan(makeRequest())

    for (const step of response.plan.steps) {
      for (const dep of step.dependsOn) {
        expect(dep).toBeLessThan(step.stepNumber)
      }
    }
  })
})

describe('createLLMProvider', () => {
  it('creates a MockLLMProvider for type "mock"', () => {
    const provider = createLLMProvider('mock')
    expect(provider.name).toBe('MockLLM')
    expect(provider.isLocal).toBe(true)
  })

  it('throws for unknown provider type', () => {
    expect(() => createLLMProvider('unknown' as 'mock')).toThrow('Unknown LLM provider')
  })
})
