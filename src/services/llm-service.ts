import type {
  LLMRequest,
  LLMResponse,
  ActionPlan,
  ActionPlanStep,
  Action,
  ActionType,
  ActionTarget,
} from '../types/agent'
import type { RiskLevel } from '../types/scan'
import { QwenLLMProvider } from './qwen-planner'

// --- Provider interface ---

export interface LLMProvider {
  readonly name: string
  readonly isLocal: boolean
  generatePlan(request: LLMRequest): Promise<LLMResponse>
}

// --- Progress callback for thinking UI ---

export type ThinkingCallback = (step: string) => void

// --- Request validation ---

const FORBIDDEN_FIELDS = ['original', 'password', 'raw', 'mapping', 'redactionmapping']

export function validateRequest(request: LLMRequest): string | null {
  if (!request.prompt || request.prompt.trim().length === 0) {
    return 'Prompt is required'
  }
  if (!request.sanitizedContext || request.sanitizedContext.trim().length === 0) {
    return 'Sanitized context is required'
  }

  const serialized = JSON.stringify(request).toLowerCase()
  for (const field of FORBIDDEN_FIELDS) {
    if (serialized.includes(`"${field}":`)) {
      return `Request must not contain "${field}" field — raw data leak detected`
    }
  }

  return null
}

// --- Mock scenario matching ---

interface ScenarioMatch {
  id: string
  keywords: RegExp
  buildPlan: (request: LLMRequest) => ActionPlan
}

function makeAction(
  type: ActionType,
  description: string,
  opts: {
    selector?: string
    tag?: string
    targetDescription?: string
    value?: string
    valueSource?: string
    requiresApproval?: boolean
  } = {},
): Action {
  const target: ActionTarget | null = opts.selector
    ? {
        selector: opts.selector,
        tag: opts.tag ?? 'unknown',
        description: opts.targetDescription ?? description,
        attributes: opts.valueSource ? { 'data-value-source': opts.valueSource } : {},
      }
    : null

  return {
    id: crypto.randomUUID(),
    type,
    target,
    value: opts.value ?? null,
    description,
    requiresApproval: opts.requiresApproval ?? type === 'fill',
    timeoutMs: type === 'wait' ? 3000 : type === 'navigate' ? 10000 : 5000,
    safe: true,
  }
}

function makeStep(
  stepNumber: number,
  action: Action,
  explanation: string,
  dependsOn: number[] = [],
  rollbackDescription: string | null = null,
): ActionPlanStep {
  return { stepNumber, action, explanation, dependsOn, rollbackDescription }
}

function makePlan(
  steps: ActionPlanStep[],
  reasoning: string,
  request: LLMRequest,
  opts: { warnings?: string[]; riskLevel?: RiskLevel } = {},
): ActionPlan {
  return {
    id: crypto.randomUUID(),
    steps,
    reasoning,
    warnings: [
      ...(opts.warnings ?? []),
      ...(request.redactionSummary.totalRedacted > 0
        ? [`${request.redactionSummary.totalRedacted} sensitive value(s) were redacted before analysis`]
        : []),
    ],
    sanitizationSummary: {
      piiRedacted: request.redactionSummary.totalRedacted,
      injectionsBlocked: 0,
      hiddenContentRemoved: 0,
    },
    estimatedDurationMs: steps.length * 2000,
    riskLevel: opts.riskLevel ?? 'low',
  }
}

// --- Extractors: pull selectors from sanitized context ---

function findSelector(context: string, pattern: RegExp): string | null {
  const match = pattern.exec(context)
  return match?.[1] ?? null
}

function findFormAction(context: string): string | null {
  const match = /Form:\s*(GET|POST)\s+(\S+)/i.exec(context)
  return match?.[2] ?? null
}

function findInputByType(context: string, type: string): string | null {
  const re = new RegExp(`\\[(${type})\\]\\s+(\\S+)`, 'i')
  const match = re.exec(context)
  return match?.[2] ?? null
}

function findButtonText(context: string): string | null {
  const match = /\[Button\]\s+(.+)/i.exec(context)
  return match?.[1]?.trim() ?? null
}

function findLinkByText(context: string, textPattern: RegExp): string | null {
  const lines = context.split('\n')
  for (const line of lines) {
    const m = /\[(.+?)\]\s*→\s*(\S+)/.exec(line)
    if (m && textPattern.test(m[1])) return m[2]
  }
  return null
}

// --- Scenario definitions ---

const SCENARIOS: ScenarioMatch[] = [
  {
    id: 'login',
    keywords: /\b(log\s*in|sign\s*in|authenticate|login)\b/i,
    buildPlan(request) {
      const ctx = request.sanitizedContext
      const loginLink = findLinkByText(ctx, /log\s*in|sign\s*in/i)
      const emailField = findInputByType(ctx, 'email|text') ?? 'input[name="email"]'
      const passwordField = 'input[type="password"]'
      const submitBtn = findButtonText(ctx) ?? 'Login'

      const steps: ActionPlanStep[] = []
      let step = 1

      if (loginLink) {
        steps.push(makeStep(step, makeAction('navigate', `Navigate to login page`, {
          value: loginLink,
        }), `Navigating to the login page at ${loginLink}`))
        step++

        steps.push(makeStep(step, makeAction('wait', 'Wait for page load', {
          value: '1500',
        }), 'Waiting for login page to fully load', [step - 1]))
        step++
      }

      steps.push(makeStep(step, makeAction('focus', 'Focus email/username field', {
        selector: emailField,
        tag: 'input',
        targetDescription: 'Email or username input field',
      }), 'Focusing the email/username input field', loginLink ? [step - 1] : []))
      step++

      steps.push(makeStep(step, makeAction('fill', 'Fill email field with user-provided value', {
        selector: emailField,
        tag: 'input',
        targetDescription: 'Email input field',
        valueSource: 'user-provided',
        requiresApproval: true,
      }), 'Filling email field — value will be provided by the user at execution time', [step - 1],
      'Clear the email field'))
      step++

      steps.push(makeStep(step, makeAction('focus', 'Focus password field', {
        selector: passwordField,
        tag: 'input',
        targetDescription: 'Password input field',
      }), 'Focusing the password input field', [step - 1]))
      step++

      steps.push(makeStep(step, makeAction('fill', 'Fill password field with user-provided value', {
        selector: passwordField,
        tag: 'input',
        targetDescription: 'Password input field',
        valueSource: 'user-provided',
        requiresApproval: true,
      }), 'Filling password field — value will be provided by the user at execution time', [step - 1],
      'Clear the password field'))
      step++

      steps.push(makeStep(step, makeAction('click', `Click "${submitBtn}" button`, {
        selector: `button:has-text("${submitBtn}"), input[type="submit"]`,
        tag: 'button',
        targetDescription: 'Submit/login button',
        requiresApproval: true,
      }), `Clicking the submit button to complete login`, [step - 1]))

      return makePlan(steps, 'Identified login flow: locate credentials fields, fill with user-provided values, and submit. No actual credentials are stored or transmitted — the user provides them at execution time.', request, {
        warnings: ['Credentials will be requested from the user at execution time', 'No passwords are stored in this plan'],
        riskLevel: 'medium',
      })
    },
  },
  {
    id: 'fill-form',
    keywords: /\b(fill|complete|submit)\b.*\b(form|application|registration|profile)\b/i,
    buildPlan(request) {
      const ctx = request.sanitizedContext
      const formAction = findFormAction(ctx)
      const submitBtn = findButtonText(ctx) ?? 'Submit'

      const fieldLines = ctx.split('\n').filter(l => /\[(text|email|tel|number|textarea)\]/i.test(l))
      const steps: ActionPlanStep[] = []
      let step = 1

      for (const line of fieldLines) {
        const m = /\[(\w+)\]\s+(\S+)(?:\s*→\s*(.+))?/.exec(line)
        if (!m) continue
        const [, fieldType, fieldName, placeholder] = m
        const selector = `[name="${fieldName}"], #${fieldName}`

        steps.push(makeStep(step, makeAction('focus', `Focus ${fieldName} field`, {
          selector,
          tag: 'input',
          targetDescription: `${fieldType} field: ${fieldName}`,
        }), `Focusing the ${fieldName} input`, step > 1 ? [step - 1] : []))
        step++

        const hasPiiPlaceholder = placeholder && /\[.*_\d{3}\]/.test(placeholder)
        steps.push(makeStep(step, makeAction('fill', `Fill ${fieldName} with ${hasPiiPlaceholder ? 'user-provided value' : 'appropriate value'}`, {
          selector,
          tag: 'input',
          targetDescription: `${fieldType} field: ${fieldName}`,
          valueSource: hasPiiPlaceholder ? 'user-provided' : 'form-context',
          requiresApproval: true,
        }), `Filling ${fieldName} — ${hasPiiPlaceholder ? 'sensitive field, user provides value at runtime' : 'value inferred from form context'}`, [step - 1],
        `Clear the ${fieldName} field`))
        step++
      }

      if (steps.length === 0) {
        steps.push(makeStep(1, makeAction('wait', 'Inspect form structure', {
          value: '1000',
        }), 'Analyzing form fields on the page'))
        step = 2
      }

      steps.push(makeStep(step, makeAction('click', `Click "${submitBtn}" button`, {
        selector: `button:has-text("${submitBtn}"), input[type="submit"]`,
        tag: 'button',
        targetDescription: 'Form submit button',
        requiresApproval: true,
      }), `Submitting the form${formAction ? ` to ${formAction}` : ''}`, [step - 1]))

      return makePlan(steps, `Identified form with ${fieldLines.length} field(s). Each sensitive field uses user-provided values at execution time. Form will be submitted after all fields are filled.`, request, {
        riskLevel: fieldLines.length > 0 ? 'medium' : 'low',
      })
    },
  },
  {
    id: 'find-registration',
    keywords: /\b(find|locate|show|where)\b.*\b(register|registration|sign\s*up|create\s*account)\b/i,
    buildPlan(request) {
      const ctx = request.sanitizedContext
      const regLink = findLinkByText(ctx, /register|sign\s*up|create\s*account|join/i)

      const steps: ActionPlanStep[] = []

      if (regLink) {
        steps.push(makeStep(1, makeAction('navigate', `Navigate to registration page`, {
          value: regLink,
        }), `Found registration link: ${regLink}`))

        steps.push(makeStep(2, makeAction('wait', 'Wait for registration page to load', {
          value: '1500',
        }), 'Waiting for the registration page to fully render', [1]))
      } else {
        steps.push(makeStep(1, makeAction('click', 'Look for registration/sign-up link', {
          selector: 'a[href*="register"], a[href*="signup"], a[href*="sign-up"], a:has-text("Register"), a:has-text("Sign Up")',
          tag: 'a',
          targetDescription: 'Registration or sign-up link',
        }), 'Searching the page for a registration link using common patterns'))

        steps.push(makeStep(2, makeAction('wait', 'Wait for navigation', {
          value: '2000',
        }), 'Waiting for page transition after clicking', [1]))
      }

      return makePlan(steps, regLink
        ? `Found a registration link at ${regLink}. Will navigate directly to it.`
        : 'No explicit registration link found in the sanitized context. Will attempt to locate one using common selector patterns.',
        request, { riskLevel: 'low' })
    },
  },
  {
    id: 'navigate-login',
    keywords: /\b(navigate|go|open|visit)\b.*\b(log\s*in|sign\s*in|login)\b/i,
    buildPlan(request) {
      const ctx = request.sanitizedContext
      const loginLink = findLinkByText(ctx, /log\s*in|sign\s*in|login/i)

      const steps: ActionPlanStep[] = []

      if (loginLink) {
        steps.push(makeStep(1, makeAction('navigate', `Navigate to login page`, {
          value: loginLink,
        }), `Found login page link: ${loginLink}`))
      } else {
        steps.push(makeStep(1, makeAction('click', 'Find and click login link', {
          selector: 'a[href*="login"], a[href*="signin"], a:has-text("Log in"), a:has-text("Sign in")',
          tag: 'a',
          targetDescription: 'Login or sign-in link',
        }), 'Searching for a login link using common selector patterns'))
      }

      steps.push(makeStep(2, makeAction('wait', 'Wait for login page to load', {
        value: '1500',
      }), 'Waiting for the login page to fully render', [1]))

      return makePlan(steps, loginLink
        ? `Located login page at ${loginLink}. Will navigate directly.`
        : 'No explicit login link found in context. Will search for common login link patterns.',
        request, { riskLevel: 'low' })
    },
  },
  {
    id: 'navigate-generic',
    keywords: /\b(navigate|go|open|visit)\b.*\b(to|page|site|url)\b/i,
    buildPlan(request) {
      const urlMatch = /https?:\/\/\S+/i.exec(request.prompt)
      const url = urlMatch?.[0] ?? request.pageUrl

      return makePlan([
        makeStep(1, makeAction('navigate', `Navigate to ${url}`, {
          value: url,
        }), `Opening the requested URL: ${url}`),
        makeStep(2, makeAction('wait', 'Wait for page to load', {
          value: '2000',
        }), 'Waiting for the page to fully render', [1]),
      ], `Navigating to the requested page at ${url}.`, request, { riskLevel: 'low' })
    },
  },
  {
    id: 'scroll-page',
    keywords: /\b(scroll)\b\s*(up|down|to\s+(?:top|bottom))?/i,
    buildPlan(request) {
      const match = /\b(scroll)\b\s*(up|down|to\s+top|to\s+bottom)?/i.exec(request.prompt)
      const raw = match?.[2]?.trim().toLowerCase() ?? 'down'
      const direction = raw.includes('up') || raw.includes('top') ? 'up' : 'down'

      return makePlan([
        makeStep(1, makeAction('scroll', `Scroll ${direction}`, {
          value: direction,
          targetDescription: `Scroll page ${direction}`,
        }), `Scrolling the page ${direction}`)
      ], `Scrolling the page ${direction}.`, request, { riskLevel: 'low' })
    },
  },
  {
    id: 'go-back',
    keywords: /\b(go\s*back|back\s*page|previous\s*page|navigate\s*back)\b/i,
    buildPlan(request) {
      return makePlan([
        makeStep(1, makeAction('go_back', 'Navigate back to previous page'), 'Going back to the previous page in browser history'),
      ], 'Navigating back to the previous page.', request, { riskLevel: 'low' })
    },
  },
  {
    id: 'click-element',
    keywords: /\b(click|press|tap|select|open)\b\s+(?:the\s+|on\s+)?["']?(.+?)["']?\s*$/i,
    buildPlan(request) {
      const match = /\b(?:click|press|tap|select|open)\b\s+(?:the\s+|on\s+)?["']?(.+?)["']?\s*$/i.exec(request.prompt)
      const targetText = match?.[1] ?? 'the element'
      const ctx = request.sanitizedContext
      const btnText = findSelector(ctx, new RegExp(`\\[Button\\]\\s+(${targetText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'))

      const selector = btnText
        ? `button:has-text("${btnText}"), a:has-text("${btnText}"), [role="button"]:has-text("${btnText}")`
        : `button:has-text("${targetText}"), a:has-text("${targetText}")`

      return makePlan([
        makeStep(1, makeAction('click', `Click "${targetText}"`, {
          selector,
          tag: 'button',
          targetDescription: targetText,
          requiresApproval: true,
        }), `Clicking the element matching "${targetText}"`),
      ], `Will click the element matching "${targetText}" on the page.`, request, { riskLevel: 'low' })
    },
  },
]

// --- Fallback plan ---

function buildFallbackPlan(request: LLMRequest): ActionPlan {
  return makePlan([
    makeStep(1, makeAction('wait', 'Analyze page structure', {
      value: '1000',
    }), 'Analyzing the current page to understand available actions'),
  ], `Unable to determine a specific action plan for: "${request.prompt}". The page has been analyzed but no matching scenario was identified. Try a more specific command like "login to this page", "fill this form", or "navigate to [URL]".`, request, {
    warnings: ['No specific scenario matched — showing page analysis only'],
    riskLevel: 'low',
  })
}

// --- Simulated latency ---

function simulateThinking(durationMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, durationMs)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

// --- MockLLMProvider ---

export class MockLLMProvider implements LLMProvider {
  readonly name = 'MockLLM'
  readonly isLocal = true

  private thinkingCallback: ThinkingCallback | null = null
  private signal: AbortSignal | null = null
  private latencyMs: number

  constructor(opts: { latencyMs?: number; onThinking?: ThinkingCallback; signal?: AbortSignal } = {}) {
    this.latencyMs = opts.latencyMs ?? 800
    this.thinkingCallback = opts.onThinking ?? null
    this.signal = opts.signal ?? null
  }

  async generatePlan(request: LLMRequest): Promise<LLMResponse> {
    const startTime = performance.now()

    const validationError = validateRequest(request)
    if (validationError) {
      throw new Error(`LLM request validation failed: ${validationError}`)
    }

    this.thinkingCallback?.('Parsing user intent...')
    await simulateThinking(this.latencyMs, this.signal ?? undefined)

    this.thinkingCallback?.('Analyzing sanitized page context...')
    await simulateThinking(this.latencyMs, this.signal ?? undefined)

    const scenario = SCENARIOS.find(s => s.keywords.test(request.prompt))

    this.thinkingCallback?.(scenario
      ? `Matched scenario: ${scenario.id} — building action plan...`
      : 'No exact scenario match — generating fallback analysis...')
    await simulateThinking(this.latencyMs, this.signal ?? undefined)

    const plan = scenario ? scenario.buildPlan(request) : buildFallbackPlan(request)

    this.thinkingCallback?.(`Plan generated: ${plan.steps.length} step(s)`)
    await simulateThinking(Math.floor(this.latencyMs / 2), this.signal ?? undefined)

    const processingTimeMs = Math.round(performance.now() - startTime)

    return {
      plan,
      reasoning: plan.reasoning,
      confidence: scenario ? 0.85 : 0.4,
      warnings: plan.warnings,
      processingTimeMs,
    }
  }
}

// --- Factory ---

export function createLLMProvider(
  type: 'mock' | 'qwen',
  opts?: { latencyMs?: number; onThinking?: ThinkingCallback; signal?: AbortSignal },
): LLMProvider {
  switch (type) {
    case 'mock':
      return new MockLLMProvider(opts)
    case 'qwen':
      return new QwenLLMProvider({ onThinking: opts?.onThinking, signal: opts?.signal })
    default:
      throw new Error(`Unknown LLM provider type: ${type}`)
  }
}
