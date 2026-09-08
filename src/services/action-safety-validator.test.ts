import { describe, it, expect } from 'vitest'
import {
  validateActionSafety,
  validateStepSafety,
  validatePlanSafety,
  validateURL,
  classifyValueSource,
} from './action-safety-validator'
import type { Action, ActionPlanStep, ActionPlan } from '../types/agent'

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: 'a1',
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

function makeStep(overrides: Partial<ActionPlanStep> = {}, actionOverrides: Partial<Action> = {}): ActionPlanStep {
  return {
    stepNumber: 1,
    action: makeAction(actionOverrides),
    explanation: 'Test step',
    dependsOn: [],
    rollbackDescription: null,
    ...overrides,
  }
}

// --- validateURL ---

describe('validateURL', () => {
  it('allows valid HTTPS URLs', () => {
    const r = validateURL('https://example.com/page')
    expect(r.allowed).toBe(true)
    expect(r.riskLevel).toBe('none')
  })

  it('allows HTTP URLs with low risk', () => {
    const r = validateURL('http://example.com')
    expect(r.allowed).toBe(true)
    expect(r.riskLevel).toBe('low')
  })

  it('allows relative paths', () => {
    const r = validateURL('/login')
    expect(r.allowed).toBe(true)
  })

  it('rejects javascript: URLs', () => {
    const r = validateURL('javascript:alert(1)')
    expect(r.allowed).toBe(false)
    expect(r.riskLevel).toBe('critical')
    expect(r.reason).toContain('javascript:')
  })

  it('rejects javascript: with spaces', () => {
    const r = validateURL('  javascript:void(0)')
    expect(r.allowed).toBe(false)
  })

  it('rejects data: URLs', () => {
    const r = validateURL('data:text/html,<h1>hi</h1>')
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('data:')
  })

  it('rejects vbscript: URLs', () => {
    const r = validateURL('vbscript:MsgBox("hi")')
    expect(r.allowed).toBe(false)
  })

  it('rejects blob: URLs', () => {
    const r = validateURL('blob:http://example.com/abc')
    expect(r.allowed).toBe(false)
  })

  it('rejects file: URLs', () => {
    const r = validateURL('file:///etc/passwd')
    expect(r.allowed).toBe(false)
  })

  it('rejects chrome: URLs', () => {
    const r = validateURL('chrome://settings')
    expect(r.allowed).toBe(false)
  })

  it('rejects chrome-extension: URLs', () => {
    const r = validateURL('chrome-extension://abcdef/popup.html')
    expect(r.allowed).toBe(false)
  })

  it('rejects about: URLs', () => {
    const r = validateURL('about:blank')
    expect(r.allowed).toBe(false)
  })

  it('rejects empty URLs', () => {
    const r = validateURL('')
    expect(r.allowed).toBe(false)
  })

  it('rejects URLs with null bytes', () => {
    const r = validateURL('https://example.com/\0evil')
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('control characters')
  })

  it('rejects URLs with newlines', () => {
    const r = validateURL('https://example.com\nevil-header: injected')
    expect(r.allowed).toBe(false)
  })

  it('rejects malformed URLs', () => {
    const r = validateURL('https://[invalid')
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('Malformed')
  })

  it('rejects unknown schemes', () => {
    const r = validateURL('custom-scheme://host')
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('Unknown URL scheme')
  })

  it('rejects ftp: URLs', () => {
    const r = validateURL('ftp://files.example.com')
    expect(r.allowed).toBe(false)
  })

  it('rejects ws: URLs', () => {
    const r = validateURL('ws://example.com/socket')
    expect(r.allowed).toBe(false)
  })

  it('rejects wss: URLs', () => {
    const r = validateURL('wss://example.com/socket')
    expect(r.allowed).toBe(false)
  })
})

// --- classifyValueSource ---

describe('classifyValueSource', () => {
  it('returns user-provided when attribute is set', () => {
    const action = makeAction({
      target: { selector: 'input', tag: 'input', description: '', attributes: { 'data-value-source': 'user-provided' } },
    })
    expect(classifyValueSource(action)).toBe('user-provided')
  })

  it('returns page-derived when attribute is set', () => {
    const action = makeAction({
      target: { selector: 'input', tag: 'input', description: '', attributes: { 'data-value-source': 'page-derived' } },
    })
    expect(classifyValueSource(action)).toBe('page-derived')
  })

  it('returns unknown when no attribute', () => {
    expect(classifyValueSource(makeAction())).toBe('unknown')
  })

  it('returns unknown when target is null', () => {
    expect(classifyValueSource(makeAction({ target: null }))).toBe('unknown')
  })
})

// --- validateActionSafety: allowed actions ---

describe('validateActionSafety — allowed actions', () => {
  it('allows a simple click', () => {
    const r = validateActionSafety(makeAction({ type: 'click' }))
    expect(r.allowed).toBe(true)
  })

  it('allows focus action', () => {
    const r = validateActionSafety(makeAction({ type: 'focus' }))
    expect(r.allowed).toBe(true)
  })

  it('allows wait action', () => {
    const r = validateActionSafety(makeAction({ type: 'wait' }))
    expect(r.allowed).toBe(true)
  })

  it('allows navigate with valid HTTPS URL', () => {
    const r = validateActionSafety(makeAction({ type: 'navigate', value: 'https://example.com' }))
    expect(r.allowed).toBe(true)
  })

  it('allows fill with approval and user-provided source', () => {
    const r = validateActionSafety(makeAction({
      type: 'fill',
      requiresApproval: true,
      value: 'test@email.com',
      target: { selector: 'input[name="email"]', tag: 'input', description: 'Email', attributes: { 'data-value-source': 'user-provided' } },
    }))
    expect(r.allowed).toBe(true)
    expect(r.riskLevel).toBe('low')
  })

  it('allows type action with target', () => {
    const r = validateActionSafety(makeAction({
      type: 'type',
      target: { selector: 'input[name="search"]', tag: 'input', description: 'Search', attributes: {} },
      value: 'query',
    }))
    expect(r.allowed).toBe(true)
  })
})

// --- validateActionSafety: disallowed action types ---

describe('validateActionSafety — disallowed types', () => {
  it('rejects eval action type', () => {
    const r = validateActionSafety(makeAction({ type: 'eval' as 'click' }))
    expect(r.allowed).toBe(false)
    expect(r.riskLevel).toBe('critical')
  })

  it('rejects execute action type', () => {
    const r = validateActionSafety(makeAction({ type: 'execute' as 'click' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects script action type', () => {
    const r = validateActionSafety(makeAction({ type: 'script' as 'click' }))
    expect(r.allowed).toBe(false)
  })
})

// --- validateActionSafety: JavaScript execution ---

describe('validateActionSafety — JavaScript execution', () => {
  it('rejects eval() in selector', () => {
    const r = validateActionSafety(makeAction({
      target: { selector: 'eval(document.body)', tag: 'div', description: '', attributes: {} },
    }))
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('JavaScript execution')
  })

  it('rejects Function() in value', () => {
    const r = validateActionSafety(makeAction({ value: 'new Function("return 1")' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects setTimeout in selector', () => {
    const r = validateActionSafety(makeAction({
      target: { selector: 'setTimeout(fn, 0)', tag: 'div', description: '', attributes: {} },
    }))
    expect(r.allowed).toBe(false)
  })

  it('rejects setInterval in value', () => {
    const r = validateActionSafety(makeAction({ value: 'setInterval(leak, 100)' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects import() in value', () => {
    const r = validateActionSafety(makeAction({ value: 'import("evil-module")' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects .constructor() escape', () => {
    const r = validateActionSafety(makeAction({ value: '"".constructor("return this")()' }))
    expect(r.allowed).toBe(false)
  })
})

// --- validateActionSafety: Script injection ---

describe('validateActionSafety — script injection', () => {
  it('rejects <script> tag in value', () => {
    const r = validateActionSafety(makeAction({ value: '<script>alert(1)</script>' }))
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('Script injection')
  })

  it('rejects onload= in selector', () => {
    const r = validateActionSafety(makeAction({
      target: { selector: 'img[onload=steal()]', tag: 'img', description: '', attributes: {} },
    }))
    expect(r.allowed).toBe(false)
  })

  it('rejects onclick= in value', () => {
    const r = validateActionSafety(makeAction({ value: 'onclick=alert(1)' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects innerHTML assignment in value', () => {
    const r = validateActionSafety(makeAction({ value: 'element.innerHTML = "<img src=x>"' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects document.write in description', () => {
    const r = validateActionSafety(makeAction({ description: 'Use document.write() to inject content' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects insertAdjacentHTML in value', () => {
    const r = validateActionSafety(makeAction({ value: 'el.insertAdjacentHTML("beforeend", payload)' }))
    expect(r.allowed).toBe(false)
  })
})

// --- validateActionSafety: Credential extraction ---

describe('validateActionSafety — credential/storage extraction', () => {
  it('rejects document.cookie in selector', () => {
    const r = validateActionSafety(makeAction({
      target: { selector: 'document.cookie', tag: 'div', description: '', attributes: {} },
    }))
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('Credential')
  })

  it('rejects localStorage.getItem in value', () => {
    const r = validateActionSafety(makeAction({ value: 'localStorage.getItem("token")' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects localStorage bracket access in value', () => {
    const r = validateActionSafety(makeAction({ value: 'localStorage["secret"]' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects sessionStorage.getItem in value', () => {
    const r = validateActionSafety(makeAction({ value: 'sessionStorage.getItem("session")' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects navigator.credentials in value', () => {
    const r = validateActionSafety(makeAction({ value: 'navigator.credentials.get()' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects PasswordCredential in value', () => {
    const r = validateActionSafety(makeAction({ value: 'new PasswordCredential(form)' }))
    expect(r.allowed).toBe(false)
  })
})

// --- validateActionSafety: Clipboard access ---

describe('validateActionSafety — clipboard access', () => {
  it('rejects navigator.clipboard in value', () => {
    const r = validateActionSafety(makeAction({ value: 'navigator.clipboard.readText()' }))
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('Clipboard')
  })

  it('rejects document.execCommand copy in value', () => {
    const r = validateActionSafety(makeAction({ value: 'document.execCommand("copy")' }))
    expect(r.allowed).toBe(false)
  })
})

// --- validateActionSafety: File system access ---

describe('validateActionSafety — file system access', () => {
  it('rejects showOpenFilePicker in value', () => {
    const r = validateActionSafety(makeAction({ value: 'showOpenFilePicker()' }))
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('File system')
  })

  it('rejects showSaveFilePicker in value', () => {
    const r = validateActionSafety(makeAction({ value: 'showSaveFilePicker()' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects new FileReader in value', () => {
    const r = validateActionSafety(makeAction({ value: 'new FileReader()' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects URL.createObjectURL in value', () => {
    const r = validateActionSafety(makeAction({ value: 'URL.createObjectURL(blob)' }))
    expect(r.allowed).toBe(false)
  })
})

// --- validateActionSafety: Downloads ---

describe('validateActionSafety — downloads', () => {
  it('rejects download attribute in click target', () => {
    const r = validateActionSafety(makeAction({
      type: 'click',
      target: { selector: 'a.dl', tag: 'a', description: 'Download', attributes: { download: 'file.pdf' } },
    }))
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('download')
  })

  it('rejects .download= in value', () => {
    const r = validateActionSafety(makeAction({ value: 'a.download = "file.exe"' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects saveAs in value', () => {
    const r = validateActionSafety(makeAction({ value: 'saveAs(blob, "dump.csv")' }))
    expect(r.allowed).toBe(false)
  })
})

// --- validateActionSafety: Browser history ---

describe('validateActionSafety — browser history', () => {
  it('rejects history.pushState', () => {
    const r = validateActionSafety(makeAction({ value: 'history.pushState({}, "", "/evil")' }))
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('Browser history')
  })

  it('rejects history.replaceState', () => {
    const r = validateActionSafety(makeAction({ value: 'history.replaceState(null, "", "/fake")' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects history.back()', () => {
    const r = validateActionSafety(makeAction({ value: 'history.back()' }))
    expect(r.allowed).toBe(false)
  })
})

// --- validateActionSafety: Extension permissions ---

describe('validateActionSafety — extension permission changes', () => {
  it('rejects chrome.runtime in value', () => {
    const r = validateActionSafety(makeAction({ value: 'chrome.runtime.sendMessage({})' }))
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('Extension permission')
  })

  it('rejects chrome.tabs in selector', () => {
    const r = validateActionSafety(makeAction({
      target: { selector: 'chrome.tabs.query({})', tag: 'div', description: '', attributes: {} },
    }))
    expect(r.allowed).toBe(false)
  })

  it('rejects chrome.permissions in value', () => {
    const r = validateActionSafety(makeAction({ value: 'chrome.permissions.request({})' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects chrome.cookies in value', () => {
    const r = validateActionSafety(makeAction({ value: 'chrome.cookies.getAll({})' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects chrome.storage in value', () => {
    const r = validateActionSafety(makeAction({ value: 'chrome.storage.local.get("key")' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects chrome.history in value', () => {
    const r = validateActionSafety(makeAction({ value: 'chrome.history.search({text: ""})' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects chrome.downloads in value', () => {
    const r = validateActionSafety(makeAction({ value: 'chrome.downloads.download({url: "x"})' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects browser.runtime (Firefox)', () => {
    const r = validateActionSafety(makeAction({ value: 'browser.runtime.sendMessage({})' }))
    expect(r.allowed).toBe(false)
  })
})

// --- validateActionSafety: External apps ---

describe('validateActionSafety — external application launch', () => {
  it('rejects window.open in value', () => {
    const r = validateActionSafety(makeAction({ value: 'window.open("http://evil.com")' }))
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('External application')
  })

  it('rejects location.assign in value', () => {
    const r = validateActionSafety(makeAction({ value: 'location.assign("/phish")' }))
    expect(r.allowed).toBe(false)
  })

  it('rejects location.replace in value', () => {
    const r = validateActionSafety(makeAction({ value: 'location.replace("http://evil.com")' }))
    expect(r.allowed).toBe(false)
  })
})

// --- validateActionSafety: Navigate ---

describe('validateActionSafety — navigate', () => {
  it('rejects navigate without URL', () => {
    const r = validateActionSafety(makeAction({ type: 'navigate', value: null }))
    expect(r.allowed).toBe(false)
  })

  it('rejects navigate with javascript: URL', () => {
    const r = validateActionSafety(makeAction({ type: 'navigate', value: 'javascript:void(0)' }))
    expect(r.allowed).toBe(false)
    expect(r.riskLevel).toBe('critical')
  })

  it('rejects navigate with data: URL', () => {
    const r = validateActionSafety(makeAction({ type: 'navigate', value: 'data:text/html,<script>alert(1)</script>' }))
    expect(r.allowed).toBe(false)
  })

  it('allows navigate with relative path', () => {
    const r = validateActionSafety(makeAction({ type: 'navigate', value: '/dashboard' }))
    expect(r.allowed).toBe(true)
  })
})

// --- validateActionSafety: Fill ---

describe('validateActionSafety — fill', () => {
  it('rejects fill without approval', () => {
    const r = validateActionSafety(makeAction({
      type: 'fill',
      requiresApproval: false,
      target: { selector: 'input', tag: 'input', description: '', attributes: {} },
    }))
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('approval')
  })

  it('rejects fill without target', () => {
    const r = validateActionSafety(makeAction({
      type: 'fill',
      requiresApproval: true,
      target: null,
    }))
    expect(r.allowed).toBe(false)
  })

  it('rejects password fill with page-derived value', () => {
    const r = validateActionSafety(makeAction({
      type: 'fill',
      requiresApproval: true,
      target: {
        selector: 'input[type="password"]',
        tag: 'input',
        description: 'Password field',
        attributes: { type: 'password', 'data-value-source': 'page-derived' },
      },
      value: 'extractedSecret',
    }))
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('Password fill must use user-provided')
    expect(r.riskLevel).toBe('critical')
  })

  it('rejects password fill with unknown source', () => {
    const r = validateActionSafety(makeAction({
      type: 'fill',
      requiresApproval: true,
      target: {
        selector: 'input[name="pwd"]',
        tag: 'input',
        description: 'Password field',
        attributes: { name: 'pwd' },
      },
      value: 'somePassword',
    }))
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('user-provided')
  })

  it('allows password fill with user-provided source', () => {
    const r = validateActionSafety(makeAction({
      type: 'fill',
      requiresApproval: true,
      target: {
        selector: 'input[type="password"]',
        tag: 'input',
        description: 'Password field',
        attributes: { type: 'password', 'data-value-source': 'user-provided' },
      },
      value: '[PASSWORD_001]',
    }))
    expect(r.allowed).toBe(true)
  })

  it('returns medium risk for unknown value source on non-password field', () => {
    const r = validateActionSafety(makeAction({
      type: 'fill',
      requiresApproval: true,
      target: { selector: 'input[name="email"]', tag: 'input', description: 'Email', attributes: {} },
      value: 'test@example.com',
    }))
    expect(r.allowed).toBe(true)
    expect(r.riskLevel).toBe('medium')
  })
})

// --- validateActionSafety: Type ---

describe('validateActionSafety — type', () => {
  it('rejects type without target', () => {
    const r = validateActionSafety(makeAction({ type: 'type', target: null }))
    expect(r.allowed).toBe(false)
  })

  it('rejects typing into password field without approval', () => {
    const r = validateActionSafety(makeAction({
      type: 'type',
      requiresApproval: false,
      target: { selector: 'input[type="password"]', tag: 'input', description: 'pw', attributes: { type: 'password' } },
    }))
    expect(r.allowed).toBe(false)
  })
})

// --- validateActionSafety: click with href ---

describe('validateActionSafety — click href validation', () => {
  it('rejects click on link with javascript: href', () => {
    const r = validateActionSafety(makeAction({
      type: 'click',
      target: { selector: 'a.evil', tag: 'a', description: 'Link', attributes: { href: 'javascript:alert(1)' } },
    }))
    expect(r.allowed).toBe(false)
  })

  it('allows click on link with https href', () => {
    const r = validateActionSafety(makeAction({
      type: 'click',
      target: { selector: 'a.page', tag: 'a', description: 'Link', attributes: { href: 'https://example.com' } },
    }))
    expect(r.allowed).toBe(true)
  })

  it('marks target=_blank as low risk', () => {
    const r = validateActionSafety(makeAction({
      type: 'click',
      target: { selector: 'a', tag: 'a', description: '', attributes: { target: '_blank', href: 'https://x.com' } },
    }))
    expect(r.allowed).toBe(true)
    expect(r.riskLevel).toBe('low')
  })
})

// --- validateActionSafety: unsafe flag / timeout ---

describe('validateActionSafety — generic safety', () => {
  it('rejects action marked unsafe', () => {
    const r = validateActionSafety(makeAction({ safe: false }))
    expect(r.allowed).toBe(false)
    expect(r.riskLevel).toBe('high')
  })

  it('rejects timeout of 0', () => {
    const r = validateActionSafety(makeAction({ timeoutMs: 0 }))
    expect(r.allowed).toBe(false)
  })

  it('rejects timeout > 30000', () => {
    const r = validateActionSafety(makeAction({ timeoutMs: 60000 }))
    expect(r.allowed).toBe(false)
  })

  it('rejects negative timeout', () => {
    const r = validateActionSafety(makeAction({ timeoutMs: -1 }))
    expect(r.allowed).toBe(false)
  })
})

// --- validateActionSafety: patterns in attributes ---

describe('validateActionSafety — dangerous target attributes', () => {
  it('rejects dangerous pattern in custom attribute', () => {
    const r = validateActionSafety(makeAction({
      target: { selector: 'div', tag: 'div', description: '', attributes: { 'data-handler': 'eval(payload)' } },
    }))
    expect(r.allowed).toBe(false)
  })

  it('skips data-value-source attribute during pattern scan', () => {
    const r = validateActionSafety(makeAction({
      type: 'fill',
      requiresApproval: true,
      target: { selector: 'input', tag: 'input', description: '', attributes: { 'data-value-source': 'user-provided' } },
    }))
    expect(r.allowed).toBe(true)
  })
})

// --- validateStepSafety ---

describe('validateStepSafety', () => {
  it('passes valid step', () => {
    const r = validateStepSafety(makeStep())
    expect(r.allowed).toBe(true)
  })

  it('rejects step depending on itself', () => {
    const r = validateStepSafety(makeStep({ stepNumber: 1, dependsOn: [1] }))
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('circular')
  })

  it('rejects step depending on later step', () => {
    const r = validateStepSafety(makeStep({ stepNumber: 2, dependsOn: [3] }))
    expect(r.allowed).toBe(false)
  })

  it('propagates action validation failure', () => {
    const r = validateStepSafety(makeStep({}, { safe: false }))
    expect(r.allowed).toBe(false)
  })
})

// --- validatePlanSafety ---

describe('validatePlanSafety', () => {
  function makePlan(steps: ActionPlanStep[]): ActionPlan {
    return {
      id: 'plan-1',
      steps,
      reasoning: 'test',
      warnings: [],
      sanitizationSummary: { piiRedacted: 0, injectionsBlocked: 0, hiddenContentRemoved: 0 },
      estimatedDurationMs: 5000,
      riskLevel: 'low',
    }
  }

  it('allows a fully valid plan', () => {
    const plan = makePlan([
      makeStep({ stepNumber: 1 }),
      makeStep({ stepNumber: 2, dependsOn: [1] }),
    ])
    const r = validatePlanSafety(plan)
    expect(r.allowed).toBe(true)
    expect(r.overallRisk).toBe('none')
  })

  it('rejects a plan with one bad step', () => {
    const plan = makePlan([
      makeStep({ stepNumber: 1 }),
      makeStep({ stepNumber: 2 }, { safe: false }),
    ])
    const r = validatePlanSafety(plan)
    expect(r.allowed).toBe(false)
    expect(r.results[1].result.allowed).toBe(false)
  })

  it('overall risk is the highest individual risk', () => {
    const plan = makePlan([
      makeStep({ stepNumber: 1 }, { type: 'navigate', value: 'http://example.com' }),
      makeStep({ stepNumber: 2 }, { type: 'click' }),
    ])
    const r = validatePlanSafety(plan)
    expect(r.allowed).toBe(true)
    expect(r.overallRisk).toBe('low')
  })

  it('detects multiple dangerous steps', () => {
    const plan = makePlan([
      makeStep({ stepNumber: 1 }, { value: 'eval(code)' }),
      makeStep({ stepNumber: 2 }, { value: 'document.cookie' }),
    ])
    const r = validatePlanSafety(plan)
    expect(r.allowed).toBe(false)
    expect(r.results.filter(s => !s.result.allowed).length).toBe(2)
  })
})
