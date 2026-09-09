import { describe, it, expect } from 'vitest'
import {
  ActionExecutor,
  MockDOMBridge,
  FailingDOMBridge,
  SUBMISSION_REQUIRES_USER_APPROVAL,
} from './action-executor'
import type { ExecutionRecord, DOMOperationResult } from './action-executor'
import type { Action, ActionPlan, ActionPlanStep } from '../types/agent'
import type { RiskLevel } from '../types/scan'

// --- Helpers ---

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: `action-${Math.random().toString(36).slice(2, 8)}`,
    type: 'click',
    target: { selector: 'button.submit', tag: 'button', description: 'Submit', attributes: {} },
    value: null,
    description: 'Click submit',
    requiresApproval: false,
    timeoutMs: 5000,
    safe: true,
    ...overrides,
  }
}

function makeStep(stepNumber: number, actionOverrides: Partial<Action> = {}, stepOverrides: Partial<ActionPlanStep> = {}): ActionPlanStep {
  return {
    stepNumber,
    action: makeAction(actionOverrides),
    explanation: 'Test step',
    dependsOn: [],
    rollbackDescription: null,
    ...stepOverrides,
  }
}

function makePlan(steps: ActionPlanStep[], id = 'plan-1'): ActionPlan {
  return {
    id,
    steps,
    reasoning: 'test',
    warnings: [],
    sanitizationSummary: { piiRedacted: 0, injectionsBlocked: 0, hiddenContentRemoved: 0 },
    estimatedDurationMs: 5000,
    riskLevel: 'low' as RiskLevel,
  }
}

function makeExecutor(overrides: {
  bridge?: MockDOMBridge
  signal?: AbortSignal
  approvedSteps?: Set<number>
} = {}) {
  const bridge = overrides.bridge ?? new MockDOMBridge()
  return {
    bridge,
    executor: new ActionExecutor({
      bridge,
      signal: overrides.signal,
      approvedSteps: overrides.approvedSteps,
    }),
  }
}

// --- Basic execution ---

describe('ActionExecutor — basic execution', () => {
  it('executes a simple click action', async () => {
    const { executor, bridge } = makeExecutor()
    const step = makeStep(1, { type: 'click' })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('completed')
    expect(rec.validation.allowed).toBe(true)
    expect(bridge.log).toHaveLength(1)
    expect(bridge.log[0].method).toBe('click')
  })

  it('executes a focus action', async () => {
    const { executor, bridge } = makeExecutor()
    const step = makeStep(1, { type: 'focus' })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('completed')
    expect(bridge.log[0].method).toBe('focus')
  })

  it('executes a type action', async () => {
    const { executor, bridge } = makeExecutor()
    const step = makeStep(1, {
      type: 'type',
      target: { selector: 'input.search', tag: 'input', description: 'Search', attributes: {} },
      value: 'hello',
    })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('completed')
    expect(bridge.log[0].method).toBe('type')
    expect(bridge.log[0].args).toEqual(['input.search', 'hello'])
  })

  it('executes a fill action with approval', async () => {
    const { executor, bridge } = makeExecutor({ approvedSteps: new Set([1]) })
    const step = makeStep(1, {
      type: 'fill',
      requiresApproval: true,
      target: { selector: 'input[name="email"]', tag: 'input', description: 'Email', attributes: { 'data-value-source': 'user-provided' } },
      value: '[EMAIL_001]',
    })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('completed')
    expect(bridge.log[0].method).toBe('fill')
  })

  it('executes a navigate action', async () => {
    const { executor, bridge } = makeExecutor()
    const step = makeStep(1, { type: 'navigate', value: 'https://example.com/page' })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('completed')
    expect(bridge.log[0].method).toBe('navigate')
    expect(bridge.log[0].args).toEqual(['https://example.com/page'])
  })

  it('executes a wait action', async () => {
    const { executor } = makeExecutor()
    const step = makeStep(1, { type: 'wait', timeoutMs: 50 })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('completed')
    expect(rec.result.detail).toContain('Waited')
  })
})

// --- Safety validation gate ---

describe('ActionExecutor — safety validation', () => {
  it('blocks unsafe action', async () => {
    const { executor } = makeExecutor()
    const step = makeStep(1, { safe: false })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
    expect(rec.result.error).toContain('safety validator')
    expect(rec.validation.allowed).toBe(false)
  })

  it('blocks disallowed action type', async () => {
    const { executor } = makeExecutor()
    const step = makeStep(1, { type: 'eval' as 'click' })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
    expect(rec.validation.allowed).toBe(false)
  })

  it('blocks javascript: URL in navigate', async () => {
    const { executor } = makeExecutor()
    const step = makeStep(1, { type: 'navigate', value: 'javascript:alert(1)' })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
  })

  it('blocks eval in selector', async () => {
    const { executor } = makeExecutor()
    const step = makeStep(1, {
      target: { selector: 'eval(document.body)', tag: 'div', description: '', attributes: {} },
    })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
    expect(rec.validation.allowed).toBe(false)
  })

  it('blocks document.cookie in value', async () => {
    const { executor } = makeExecutor()
    const step = makeStep(1, { value: 'document.cookie' })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
  })

  it('blocks localStorage extraction in value', async () => {
    const { executor } = makeExecutor()
    const step = makeStep(1, { value: 'localStorage.getItem("token")' })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
  })

  it('blocks chrome.runtime in value', async () => {
    const { executor } = makeExecutor()
    const step = makeStep(1, { value: 'chrome.runtime.sendMessage({})' })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
  })

  it('blocks <script> injection in value', async () => {
    const { executor } = makeExecutor()
    const step = makeStep(1, { value: '<script>steal()</script>' })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
  })
})

// --- Approval enforcement ---

describe('ActionExecutor — approval enforcement', () => {
  it('blocks unapproved fill action', async () => {
    const { executor } = makeExecutor({ approvedSteps: new Set() })
    const step = makeStep(1, {
      type: 'fill',
      requiresApproval: true,
      target: { selector: 'input', tag: 'input', description: 'Field', attributes: { 'data-value-source': 'user-provided' } },
    })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
    expect(rec.result.error).toContain('not approved')
  })

  it('allows approved fill action', async () => {
    const { executor } = makeExecutor({ approvedSteps: new Set([1]) })
    const step = makeStep(1, {
      type: 'fill',
      requiresApproval: true,
      target: { selector: 'input[name="email"]', tag: 'input', description: 'Email', attributes: { 'data-value-source': 'user-provided' } },
      value: 'test@test.com',
    })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('completed')
  })
})

// --- Password field protection ---

describe('ActionExecutor — password field protection', () => {
  it('blocks fill to password field without user-provided source', async () => {
    const { executor } = makeExecutor({ approvedSteps: new Set([1]) })
    const step = makeStep(1, {
      type: 'fill',
      requiresApproval: true,
      target: {
        selector: 'input[type="password"]',
        tag: 'input',
        description: 'Password',
        attributes: { type: 'password' },
      },
      value: 'extracted-secret',
    })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
    expect(rec.result.error).toContain('user-provided')
  })

  it('blocks type into password field without user-provided source', async () => {
    const { executor } = makeExecutor()
    const step = makeStep(1, {
      type: 'type',
      requiresApproval: true,
      target: {
        selector: 'input[name="passwd"]',
        tag: 'input',
        description: 'Password',
        attributes: { name: 'passwd' },
      },
      value: 'secret',
    })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
  })

  it('allows password fill with user-provided source', async () => {
    const { executor } = makeExecutor({ approvedSteps: new Set([1]) })
    const step = makeStep(1, {
      type: 'fill',
      requiresApproval: true,
      target: {
        selector: 'input[type="password"]',
        tag: 'input',
        description: 'Password',
        attributes: { type: 'password', 'data-value-source': 'user-provided' },
      },
      value: '[PASSWORD_001]',
    })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('completed')
  })
})

// --- Form submission blocking ---

describe('ActionExecutor — form submission blocking', () => {
  it('blocks sensitive form submission when steps are NOT pre-approved', async () => {
    // Fill (step 1) is approved so it completes; submit (step 2) is NOT approved, so the
    // form-submit guard fires and returns 'blocked' rather than executing the submission.
    const { executor } = makeExecutor({ approvedSteps: new Set([1]) })

    const fillStep = makeStep(1, {
      type: 'fill',
      requiresApproval: true,    // fill always requires approval (enforced by safety validator)
      target: { selector: 'input[name="email"]', tag: 'input', description: 'Email', attributes: { 'data-value-source': 'user-provided' } },
      value: 'test@test.com',
    })
    const submitStep = makeStep(2, {
      type: 'click',
      target: { selector: 'button[type="submit"]', tag: 'button', description: 'Submit form', attributes: { type: 'submit' } },
    }, { dependsOn: [1] })

    const plan = makePlan([fillStep, submitStep])
    const result = await executor.executePlan(plan)

    expect(result.status).toBe('blocked')
    expect(result.stoppedReason).toBe(SUBMISSION_REQUIRES_USER_APPROVAL)
    expect(result.records[1].result.detail).toBe(SUBMISSION_REQUIRES_USER_APPROVAL)
  })

  it('allows form submission when steps are pre-approved (user reviewed the plan)', async () => {
    // Both steps in approvedSteps — user reviewed and approved the plan
    const { executor } = makeExecutor({ approvedSteps: new Set([1, 2]) })

    const fillStep = makeStep(1, {
      type: 'fill',
      requiresApproval: true,
      target: { selector: 'input[name="email"]', tag: 'input', description: 'Email', attributes: { 'data-value-source': 'user-provided' } },
      value: 'test@test.com',
    })
    const submitStep = makeStep(2, {
      type: 'click',
      target: { selector: 'button[type="submit"]', tag: 'button', description: 'Submit form', attributes: { type: 'submit' } },
    }, { dependsOn: [1] })

    const plan = makePlan([fillStep, submitStep])
    const result = await executor.executePlan(plan)

    expect(result.status).toBe('completed')
  })

  it('blocks input[type=submit] after type actions when NOT pre-approved', async () => {
    const { executor } = makeExecutor({ approvedSteps: new Set() })

    const typeStep = makeStep(1, {
      type: 'type',
      target: { selector: 'input[name="search"]', tag: 'input', description: 'Search', attributes: { 'data-value-source': 'user-provided' } },
      value: 'query',
    })
    const submitStep = makeStep(2, {
      type: 'click',
      target: { selector: 'input.login-submit', tag: 'input', description: 'Submit', attributes: { type: 'submit' } },
    }, { dependsOn: [1] })

    const plan = makePlan([typeStep, submitStep])
    const result = await executor.executePlan(plan)

    expect(result.status).toBe('blocked')
  })

  it('allows click on non-submit button without preceding fills', async () => {
    const { executor } = makeExecutor()
    const step = makeStep(1, {
      type: 'click',
      target: { selector: 'a.nav-link', tag: 'a', description: 'Go to dashboard', attributes: {} },
    })
    const plan = makePlan([step])
    const result = await executor.executePlan(plan)

    expect(result.status).toBe('completed')
  })
})

// --- Plan execution ---

describe('ActionExecutor — plan execution', () => {
  it('executes all steps in order', async () => {
    const { executor, bridge } = makeExecutor()
    const plan = makePlan([
      makeStep(1, { type: 'focus', target: { selector: 'input.first', tag: 'input', description: 'First', attributes: {} } }),
      makeStep(2, { type: 'click', target: { selector: 'button.next', tag: 'button', description: 'Next', attributes: {} } }),
    ])

    const result = await executor.executePlan(plan)

    expect(result.status).toBe('completed')
    expect(result.records).toHaveLength(2)
    expect(bridge.log[0].method).toBe('focus')
    expect(bridge.log[1].method).toBe('click')
  })

  it('stops on first failure', async () => {
    const bridge = new FailingDOMBridge()
    const { executor } = makeExecutor({ bridge })
    const plan = makePlan([
      makeStep(1, { type: 'click' }),
      makeStep(2, { type: 'focus' }),
    ])

    const result = await executor.executePlan(plan)

    expect(result.status).toBe('failed')
    expect(result.records).toHaveLength(1)
    expect(result.stoppedReason).toBeTruthy()
  })

  it('skips steps with unmet dependencies', async () => {
    const bridge = new FailingDOMBridge()
    const { executor } = makeExecutor({ bridge })
    const plan = makePlan([
      makeStep(1, { type: 'click' }),
      makeStep(2, { type: 'focus' }, { dependsOn: [1] }),
    ])

    const result = await executor.executePlan(plan)

    expect(result.status).toBe('failed')
    expect(result.records[0].result.status).toBe('failed')
  })

  it('records execution history', async () => {
    const { executor } = makeExecutor()
    const plan = makePlan([
      makeStep(1, { type: 'focus', target: { selector: 'input', tag: 'input', description: '', attributes: {} } }),
      makeStep(2, { type: 'click' }),
    ])

    await executor.executePlan(plan)

    const records = executor.getRecords()
    expect(records).toHaveLength(2)
    expect(records[0].stepNumber).toBe(1)
    expect(records[1].stepNumber).toBe(2)
  })
})

// --- Cancellation ---

describe('ActionExecutor — cancellation', () => {
  it('cancels plan execution via AbortSignal', async () => {
    const controller = new AbortController()
    const { executor } = makeExecutor({ signal: controller.signal })

    const waitStep = makeStep(1, { type: 'wait', timeoutMs: 10000 })
    const plan = makePlan([waitStep, makeStep(2)])

    const promise = executor.executePlan(plan)
    setTimeout(() => controller.abort(), 20)

    await expect(promise).rejects.toThrow()
  })

  it('does not execute after abort', async () => {
    const controller = new AbortController()
    controller.abort()
    const { executor, bridge } = makeExecutor({ signal: controller.signal })

    const plan = makePlan([makeStep(1)])
    await expect(executor.executePlan(plan)).rejects.toThrow()
    expect(bridge.log).toHaveLength(0)
  })
})

// --- Timeout ---

describe('ActionExecutor — timeout', () => {
  it('fails action that exceeds timeout', async () => {
    const slowBridge = new MockDOMBridge()
    slowBridge.click = async () => {
      await new Promise(resolve => setTimeout(resolve, 500))
      return { success: true, error: null, detail: null }
    }

    const { executor } = makeExecutor({ bridge: slowBridge })
    const step = makeStep(1, { type: 'click', timeoutMs: 50 })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
    expect(rec.result.error).toContain('timed out')
  })
})

// --- Execution listener ---

describe('ActionExecutor — listeners', () => {
  it('emits execution records to listeners', async () => {
    const events: ExecutionRecord[] = []
    const { executor } = makeExecutor()
    executor.onExecution(rec => events.push(rec))

    const plan = makePlan([makeStep(1), makeStep(2)])
    await executor.executePlan(plan)

    expect(events).toHaveLength(2)
  })

  it('unsubscribes listener', async () => {
    const events: ExecutionRecord[] = []
    const { executor } = makeExecutor()
    const unsub = executor.onExecution(rec => events.push(rec))
    unsub()

    await executor.executePlan(makePlan([makeStep(1)]))
    expect(events).toHaveLength(0)
  })

  it('listener errors do not break execution', async () => {
    const { executor } = makeExecutor()
    executor.onExecution(() => { throw new Error('listener crash') })

    const plan = makePlan([makeStep(1)])
    const result = await executor.executePlan(plan)

    expect(result.status).toBe('completed')
  })
})

// --- DOMBridge failure handling ---

describe('ActionExecutor — bridge failures', () => {
  it('reports bridge error as failed result', async () => {
    const bridge = new FailingDOMBridge()
    const { executor } = makeExecutor({ bridge })
    const step = makeStep(1, { type: 'click' })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
    expect(rec.result.error).toBe('Element not found')
  })

  it('reports bridge error on fill', async () => {
    const bridge = new FailingDOMBridge()
    const { executor } = makeExecutor({ bridge, approvedSteps: new Set([1]) })
    const step = makeStep(1, {
      type: 'fill',
      requiresApproval: true,
      target: { selector: 'input', tag: 'input', description: 'Field', attributes: { 'data-value-source': 'user-provided' } },
      value: 'test',
    })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
    expect(rec.result.error).toBe('Element not interactable')
  })

  it('handles bridge throwing an exception', async () => {
    const bridge = new MockDOMBridge()
    bridge.click = async (): Promise<DOMOperationResult> => { throw new Error('Connection lost') }
    const { executor } = makeExecutor({ bridge })
    const step = makeStep(1, { type: 'click' })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
    expect(rec.result.error).toBe('Connection lost')
  })
})

// --- Never extract credentials ---

describe('ActionExecutor — credential protection', () => {
  it('never allows fill to password with page-derived source even if approved', async () => {
    const { executor } = makeExecutor({ approvedSteps: new Set([1]) })
    const step = makeStep(1, {
      type: 'fill',
      requiresApproval: true,
      target: {
        selector: 'input[type="password"]',
        tag: 'input',
        description: 'Password',
        attributes: { type: 'password', 'data-value-source': 'page-derived' },
      },
      value: 'stolen-password',
    })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
  })

  it('never executes navigator.clipboard extraction', async () => {
    const { executor } = makeExecutor()
    const step = makeStep(1, { value: 'navigator.clipboard.readText()' })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
  })

  it('never executes sessionStorage extraction', async () => {
    const { executor } = makeExecutor()
    const step = makeStep(1, { value: 'sessionStorage.getItem("auth")' })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
  })
})

// --- MockDOMBridge ---

describe('MockDOMBridge', () => {
  it('logs all operations', async () => {
    const bridge = new MockDOMBridge()
    await bridge.click('a')
    await bridge.focus('input')
    await bridge.type('input', 'text')
    await bridge.fill('input', 'val')
    await bridge.navigate('https://x.com')
    await bridge.elementExists('div')
    await bridge.getElementAttribute('div', 'id')
    await bridge.isPasswordField('input[type="password"]')

    expect(bridge.log).toHaveLength(8)
    expect(bridge.log.map(l => l.method)).toEqual([
      'click', 'focus', 'type', 'fill', 'navigate', 'elementExists', 'getElementAttribute', 'isPasswordField',
    ])
  })

  it('isPasswordField returns true for password selectors', async () => {
    const bridge = new MockDOMBridge()
    expect(await bridge.isPasswordField('input[type="password"]')).toBe(true)
    expect(await bridge.isPasswordField('input[name="email"]')).toBe(false)
  })
})

// --- End-to-end plan execution ---

describe('End-to-end: full plan execution flow', () => {
  it('executes a navigate + extract plan without any blocks', async () => {
    const bridge = new MockDOMBridge()
    const plan = makePlan([
      makeStep(1, { type: 'navigate', target: null as unknown as Action['target'], value: 'https://example.com' }),
      makeStep(2, { type: 'extract', target: { selector: 'body', tag: 'body', description: 'page body', attributes: {} }, value: null }, { dependsOn: [1] }),
    ])
    const executor = new ActionExecutor({ bridge, approvedSteps: new Set([1, 2]) })
    const result = await executor.executePlan(plan)

    expect(result.status).toBe('completed')
    expect(result.records).toHaveLength(2)
    expect(result.records[0].result.status).toBe('completed')
    expect(result.records[1].result.status).toBe('completed')
    expect(bridge.log.map(l => l.method)).toEqual(['navigate', 'extract'])
  })

  it('executes a navigate + type + click search plan', async () => {
    const bridge = new MockDOMBridge()
    const plan = makePlan([
      makeStep(1, { type: 'navigate', target: null as unknown as Action['target'], value: 'https://google.com' }),
      makeStep(2, {
        type: 'type',
        target: { selector: 'input[name="q"]', tag: 'input', description: 'Search input', attributes: {} },
        value: 'Claude AI',
      }, { dependsOn: [1] }),
      makeStep(3, {
        type: 'click',
        target: { selector: 'input[type="submit"]', tag: 'input', description: 'Search button', attributes: {} },
      }, { dependsOn: [2] }),
    ])
    const executor = new ActionExecutor({ bridge, approvedSteps: new Set([1, 2, 3]) })
    const result = await executor.executePlan(plan)

    expect(result.status).toBe('completed')
    expect(bridge.log[1]).toEqual({ method: 'type', args: ['input[name="q"]', 'Claude AI'] })
  })

  it('executes a login flow (fill email + fill password + submit) when all steps are pre-approved', async () => {
    const bridge = new MockDOMBridge()
    const plan = makePlan([
      makeStep(1, { type: 'navigate', target: null as unknown as Action['target'], value: 'https://example.com/login' }),
      makeStep(2, {
        type: 'fill',
        target: { selector: 'input[type="email"]', tag: 'input', description: 'Fill email field', attributes: { 'data-value-source': 'user-provided' } },
        value: 'user@example.com',
        requiresApproval: true,
      }, { dependsOn: [1] }),
      makeStep(3, {
        type: 'fill',
        target: { selector: 'input[type="password"]', tag: 'input', description: 'Fill password field', attributes: { 'data-value-source': 'user-provided' } },
        value: 'hunter2',
        requiresApproval: true,
      }, { dependsOn: [2] }),
      makeStep(4, {
        type: 'click',
        target: { selector: 'button[type="submit"]', tag: 'button', description: 'Submit login form', attributes: {} },
        requiresApproval: true,
      }, { dependsOn: [3] }),
    ])
    const executor = new ActionExecutor({ bridge, approvedSteps: new Set([1, 2, 3, 4]) })
    const result = await executor.executePlan(plan)

    expect(result.status).toBe('completed')
    expect(result.records).toHaveLength(4)
    expect(result.records[2].result.status).toBe('completed')   // password fill
    expect(result.records[3].result.status).toBe('completed')   // form submit
  })

  it('bypasses password guard when step is pre-approved (user-provided data attribute set)', async () => {
    const bridge = new MockDOMBridge()
    const step = makeStep(5, {
      type: 'fill',
      target: { selector: 'input[type="password"]', tag: 'input', description: 'Password', attributes: { 'data-value-source': 'user-provided' } },
      value: 'secret',
      requiresApproval: true,
    })
    const executor = new ActionExecutor({ bridge, approvedSteps: new Set([5]) })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('completed')
    expect(bridge.log[0]).toEqual({ method: 'fill', args: ['input[type="password"]', 'secret'] })
  })

  it('bypasses password guard when step is in approvedSteps without data attribute', async () => {
    // Password fill with no data-value-source attribute, but step is pre-approved
    const bridge = new MockDOMBridge()
    const step = makeStep(7, {
      type: 'fill',
      target: { selector: 'input[name="pwd"]', tag: 'input', description: 'Password field', attributes: {} },
      value: 'mypassword',
      requiresApproval: true,
    })
    const executor = new ActionExecutor({ bridge, approvedSteps: new Set([7]) })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('completed')
    expect(bridge.log[0].method).toBe('fill')
  })

  it('still blocks password fill when step is NOT in approvedSteps and no user-provided source', async () => {
    const bridge = new MockDOMBridge()
    const step = makeStep(1, {
      type: 'fill',
      target: { selector: 'input[type="password"]', tag: 'input', description: 'Password', attributes: {} },
      value: 'secret',
      requiresApproval: true,
    })
    const executor = new ActionExecutor({ bridge, approvedSteps: new Set() })  // step 1 not approved
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('failed')
    expect(rec.result.error).toContain('user-provided')
  })

  it('bypasses form-submit guard when all steps are pre-approved', async () => {
    const bridge = new MockDOMBridge()
    const plan = makePlan([
      makeStep(1, {
        type: 'fill',
        target: { selector: 'input[type="email"]', tag: 'input', description: 'Fill email', attributes: { 'data-value-source': 'user-provided' } },
        value: 'user@example.com',
        requiresApproval: true,
      }),
      makeStep(2, {
        type: 'click',
        target: { selector: 'button[type="submit"]', tag: 'button', description: 'Submit the form', attributes: {} },
        requiresApproval: true,
      }, { dependsOn: [1] }),
    ])
    const executor = new ActionExecutor({ bridge, approvedSteps: new Set([1, 2]) })
    const result = await executor.executePlan(plan)

    // Should complete, NOT return 'blocked'
    expect(result.status).toBe('completed')
    expect(result.stoppedReason).toBeNull()
  })

  it('still blocks form-submit when steps are NOT pre-approved', async () => {
    const bridge = new MockDOMBridge()
    // Fill (step 1) is approved so it completes; submit (step 2) is NOT in approvedSteps, so
    // the form-submit guard fires and returns 'blocked' before executing the submission.
    const plan = makePlan([
      makeStep(1, {
        type: 'fill',
        target: { selector: 'input[type="email"]', tag: 'input', description: 'Fill email', attributes: { 'data-value-source': 'user-provided' } },
        value: 'user@example.com',
        requiresApproval: true,   // fill always requires approval (safety validator enforces this)
      }),
      makeStep(2, {
        type: 'click',
        target: { selector: 'button[type="submit"]', tag: 'button', description: 'Submit the form', attributes: {} },
        requiresApproval: false,
      }, { dependsOn: [1] }),
    ])
    const executor = new ActionExecutor({ bridge, approvedSteps: new Set([1]) })  // fill approved, submit NOT
    const result = await executor.executePlan(plan)

    expect(result.status).toBe('blocked')
    expect(result.stoppedReason).toBe(SUBMISSION_REQUIRES_USER_APPROVAL)
  })

  it('execution records are emitted in order via onExecution', async () => {
    const bridge = new MockDOMBridge()
    const plan = makePlan([
      makeStep(1, { type: 'navigate', target: null as unknown as Action['target'], value: 'https://example.com' }),
      makeStep(2, { type: 'extract', target: { selector: 'h1', tag: 'h1', description: 'heading', attributes: {} }, value: null }, { dependsOn: [1] }),
    ])
    const executor = new ActionExecutor({ bridge, approvedSteps: new Set([1, 2]) })

    const emitted: number[] = []
    executor.onExecution(rec => emitted.push(rec.stepNumber))

    await executor.executePlan(plan)
    expect(emitted).toEqual([1, 2])
  })

  it('does not execute subsequent steps when an earlier step fails', async () => {
    const bridge = new FailingDOMBridge()
    const plan = makePlan([
      makeStep(1, { type: 'click' }),
      makeStep(2, { type: 'click' }, { dependsOn: [1] }),
    ])
    const executor = new ActionExecutor({ bridge, approvedSteps: new Set([1, 2]) })
    const result = await executor.executePlan(plan)

    expect(result.status).toBe('failed')
    expect(result.records).toHaveLength(1)  // stopped after step 1 failed
  })

  it('skips steps whose dependencies were not completed', async () => {
    const bridge = new FailingDOMBridge()
    const plan = makePlan([
      makeStep(1, { type: 'click' }),   // fails
      makeStep(2, { type: 'click' }, { dependsOn: [] }),   // no dependency on 1 — but plan stops at fail above
    ])
    const executor = new ActionExecutor({ bridge, approvedSteps: new Set([1, 2]) })
    const result = await executor.executePlan(plan)

    // executePlan stops at first failure
    expect(result.status).toBe('failed')
  })

  it('extract detail is accessible in execution record', async () => {
    const bridge = new MockDOMBridge()
    const step = makeStep(1, {
      type: 'extract',
      target: { selector: 'main', tag: 'main', description: 'Main content', attributes: {} },
    })
    const executor = new ActionExecutor({ bridge, approvedSteps: new Set([1]) })
    const rec = await executor.executeStep(step)

    expect(rec.result.status).toBe('completed')
    expect(rec.result.detail).toContain('Extracted')
    expect(rec.result.detail).toContain('main')
  })
})
