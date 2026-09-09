import type { Action, ActionType, ActionPlanStep, ActionPlan } from '../types/agent'
import type { RiskLevel } from '../types/scan'

// --- Validation result ---

export interface ActionValidationResult {
  allowed: boolean
  reason: string
  riskLevel: RiskLevel
}

export interface PlanValidationResult {
  allowed: boolean
  results: { stepNumber: number; result: ActionValidationResult }[]
  overallRisk: RiskLevel
}

// --- Allowed action types ---

const ALLOWED_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  'navigate', 'click', 'fill', 'type', 'focus', 'wait',
  'scroll', 'select', 'send_keys', 'go_back', 'extract',
])

// --- Dangerous patterns ---

const JAVASCRIPT_EXECUTION_PATTERNS: readonly RegExp[] = [
  /javascript\s*:/i,
  /eval\s*\(/i,
  /Function\s*\(/i,
  /setTimeout\s*\(/i,
  /setInterval\s*\(/i,
  /new\s+Function\s*\(/i,
  /\.constructor\s*\(/i,
  /import\s*\(/i,
]

const SCRIPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /<script[\s>]/i,
  /<\/script>/i,
  /on\w+\s*=\s*/i,
  /\.innerHTML\s*=/i,
  /\.outerHTML\s*=/i,
  /\.insertAdjacentHTML\s*\(/i,
  /document\.write\s*\(/i,
  /document\.writeln\s*\(/i,
]

const CREDENTIAL_EXTRACTION_PATTERNS: readonly RegExp[] = [
  /document\.cookie/i,
  /\.getCookie\s*\(/i,
  /\.setCookie\s*\(/i,
  /localStorage\s*\.\s*(getItem|setItem|removeItem|clear|key|length)/i,
  /localStorage\s*\[/i,
  /sessionStorage\s*\.\s*(getItem|setItem|removeItem|clear|key|length)/i,
  /sessionStorage\s*\[/i,
  /\.credentials\s*\./i,
  /navigator\.credentials/i,
  /PasswordCredential/i,
  /FederatedCredential/i,
]

const CLIPBOARD_PATTERNS: readonly RegExp[] = [
  /navigator\.clipboard/i,
  /document\.execCommand\s*\(\s*['"]copy/i,
  /document\.execCommand\s*\(\s*['"]cut/i,
  /document\.execCommand\s*\(\s*['"]paste/i,
  /ClipboardEvent/i,
]

const FILE_SYSTEM_PATTERNS: readonly RegExp[] = [
  /showOpenFilePicker/i,
  /showSaveFilePicker/i,
  /showDirectoryPicker/i,
  /FileSystemAccess/i,
  /\.files\s*\[/i,
  /new\s+FileReader/i,
  /new\s+Blob\s*\(/i,
  /URL\.createObjectURL/i,
]

const DOWNLOAD_PATTERNS: readonly RegExp[] = [
  /\.download\s*=/i,
  /download\s*=\s*["']/i,
  /saveAs\s*\(/i,
  /FileSaver/i,
  /\.href\s*=\s*['"]blob:/i,
]

const BROWSER_HISTORY_PATTERNS: readonly RegExp[] = [
  /history\.pushState/i,
  /history\.replaceState/i,
  /history\.go\s*\(/i,
  /history\.back\s*\(/i,
  /history\.forward\s*\(/i,
]

const EXTENSION_PATTERNS: readonly RegExp[] = [
  /chrome\.runtime/i,
  /chrome\.tabs/i,
  /chrome\.permissions/i,
  /chrome\.storage/i,
  /chrome\.cookies/i,
  /chrome\.webRequest/i,
  /chrome\.downloads/i,
  /chrome\.history/i,
  /chrome\.bookmarks/i,
  /browser\.runtime/i,
  /browser\.tabs/i,
  /browser\.permissions/i,
]

const EXTERNAL_APP_PATTERNS: readonly RegExp[] = [
  /window\.open\s*\(/i,
  /\.open\s*\(\s*['"](?!https?:\/\/)/i,
  /location\.assign\s*\(/i,
  /location\.replace\s*\(/i,
]

const DANGEROUS_URL_SCHEMES: readonly string[] = [
  'javascript:',
  'data:',
  'vbscript:',
  'blob:',
  'file:',
  'ftp:',
  'ws:',
  'wss:',
  'chrome:',
  'chrome-extension:',
  'moz-extension:',
  'about:',
]

// --- Value source detection ---

export type ValueSource = 'user-provided' | 'page-derived' | 'unknown'

export function classifyValueSource(action: Action): ValueSource {
  if (action.target?.attributes['data-value-source'] === 'user-provided') {
    return 'user-provided'
  }
  if (action.target?.attributes['data-value-source'] === 'page-derived') {
    return 'page-derived'
  }
  return 'unknown'
}

// --- URL validation ---

export function validateURL(url: string): ActionValidationResult {
  const trimmed = url.trim()

  if (trimmed.length === 0) {
    return { allowed: false, reason: 'Empty URL', riskLevel: 'medium' }
  }

  const lower = trimmed.toLowerCase()

  for (const scheme of DANGEROUS_URL_SCHEMES) {
    if (lower.startsWith(scheme)) {
      return { allowed: false, reason: `Blocked URL scheme: ${scheme}`, riskLevel: 'critical' }
    }
  }

  if (lower.includes('\0') || lower.includes('\r') || lower.includes('\n')) {
    return { allowed: false, reason: 'URL contains control characters', riskLevel: 'critical' }
  }

  if (/^[\w+.-]+:/.test(trimmed) && !lower.startsWith('http://') && !lower.startsWith('https://')) {
    return { allowed: false, reason: `Unknown URL scheme: ${trimmed.split(':')[0]}`, riskLevel: 'high' }
  }

  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    try {
      new URL(trimmed)
    } catch {
      return { allowed: false, reason: 'Malformed URL', riskLevel: 'medium' }
    }
  }

  if (lower.startsWith('http://')) {
    return { allowed: true, reason: 'HTTP URL (insecure but allowed)', riskLevel: 'low' }
  }

  return { allowed: true, reason: 'Valid URL', riskLevel: 'none' }
}

// --- Pattern scanning ---

interface PatternGroup {
  patterns: readonly RegExp[]
  category: string
  riskLevel: RiskLevel
}

const ALL_PATTERN_GROUPS: readonly PatternGroup[] = [
  { patterns: JAVASCRIPT_EXECUTION_PATTERNS, category: 'JavaScript execution', riskLevel: 'critical' },
  { patterns: SCRIPT_INJECTION_PATTERNS, category: 'Script injection', riskLevel: 'critical' },
  { patterns: CREDENTIAL_EXTRACTION_PATTERNS, category: 'Credential/storage extraction', riskLevel: 'critical' },
  { patterns: CLIPBOARD_PATTERNS, category: 'Clipboard access', riskLevel: 'high' },
  { patterns: FILE_SYSTEM_PATTERNS, category: 'File system access', riskLevel: 'critical' },
  { patterns: DOWNLOAD_PATTERNS, category: 'Download attempt', riskLevel: 'high' },
  { patterns: BROWSER_HISTORY_PATTERNS, category: 'Browser history access', riskLevel: 'high' },
  { patterns: EXTENSION_PATTERNS, category: 'Extension permission access', riskLevel: 'critical' },
  { patterns: EXTERNAL_APP_PATTERNS, category: 'External application launch', riskLevel: 'high' },
]

function scanPatterns(text: string): { category: string; riskLevel: RiskLevel; matched: string } | null {
  for (const group of ALL_PATTERN_GROUPS) {
    for (const pattern of group.patterns) {
      const match = pattern.exec(text)
      if (match) {
        return { category: group.category, riskLevel: group.riskLevel, matched: match[0] }
      }
    }
  }
  return null
}

function scanAllFields(action: Action): { category: string; riskLevel: RiskLevel; field: string } | null {
  const fields: { name: string; value: string | null | undefined }[] = [
    { name: 'selector', value: action.target?.selector },
    { name: 'value', value: action.value },
    { name: 'description', value: action.description },
    { name: 'target.description', value: action.target?.description },
  ]

  if (action.target?.attributes) {
    for (const [key, val] of Object.entries(action.target.attributes)) {
      if (key === 'data-value-source') continue
      fields.push({ name: `attribute:${key}`, value: val })
    }
  }

  for (const field of fields) {
    if (!field.value) continue
    const hit = scanPatterns(field.value)
    if (hit) {
      return { category: hit.category, riskLevel: hit.riskLevel, field: field.name }
    }
  }
  return null
}

// --- Risk escalation ---

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ['none', 'low', 'medium', 'high', 'critical']
  return order.indexOf(a) >= order.indexOf(b) ? a : b
}

// --- Core validator ---

export function validateActionSafety(action: Action): ActionValidationResult {
  if (!ALLOWED_ACTION_TYPES.has(action.type)) {
    return { allowed: false, reason: `Disallowed action type: "${action.type}"`, riskLevel: 'critical' }
  }

  if (!action.safe) {
    return { allowed: false, reason: 'Action explicitly marked as unsafe by the planner', riskLevel: 'high' }
  }

  if (action.timeoutMs <= 0 || action.timeoutMs > 30000) {
    return { allowed: false, reason: `Invalid timeout ${action.timeoutMs}ms — must be 1–30000`, riskLevel: 'medium' }
  }

  const patternHit = scanAllFields(action)
  if (patternHit) {
    return {
      allowed: false,
      reason: `${patternHit.category} detected in ${patternHit.field}`,
      riskLevel: patternHit.riskLevel,
    }
  }

  if (action.type === 'navigate') {
    return validateNavigateAction(action)
  }

  if (action.type === 'fill') {
    return validateFillAction(action)
  }

  if (action.type === 'click') {
    return validateClickAction(action)
  }

  if (action.type === 'type') {
    return validateTypeAction(action)
  }

  return { allowed: true, reason: 'Action passed all safety checks', riskLevel: 'none' }
}

function validateNavigateAction(action: Action): ActionValidationResult {
  if (!action.value) {
    return { allowed: false, reason: 'Navigate action requires a URL value', riskLevel: 'medium' }
  }
  return validateURL(action.value)
}

function validateFillAction(action: Action): ActionValidationResult {
  if (!action.requiresApproval) {
    return { allowed: false, reason: 'Fill actions must require user approval', riskLevel: 'high' }
  }

  if (!action.target) {
    return { allowed: false, reason: 'Fill action requires a target element', riskLevel: 'medium' }
  }

  const source = classifyValueSource(action)

  if (isPasswordTarget(action) && source !== 'user-provided') {
    return {
      allowed: false,
      reason: 'Password fill must use user-provided values — never auto-extract from the page',
      riskLevel: 'critical',
    }
  }

  let risk: RiskLevel = 'low'
  if (source === 'unknown') risk = 'medium'

  return { allowed: true, reason: `Fill action approved (source: ${source})`, riskLevel: risk }
}

function validateClickAction(action: Action): ActionValidationResult {
  if (action.target?.attributes['href']) {
    const urlResult = validateURL(action.target.attributes['href'])
    if (!urlResult.allowed) {
      return { allowed: false, reason: `Click target href blocked: ${urlResult.reason}`, riskLevel: urlResult.riskLevel }
    }
  }

  if (action.target?.attributes['download'] !== undefined) {
    return { allowed: false, reason: 'Click target triggers a download', riskLevel: 'high' }
  }

  if (action.target?.attributes['target'] === '_blank') {
    return { allowed: true, reason: 'Click opens new tab — allowed with caution', riskLevel: 'low' }
  }

  return { allowed: true, reason: 'Click action passed all safety checks', riskLevel: 'none' }
}

function validateTypeAction(action: Action): ActionValidationResult {
  if (!action.target) {
    return { allowed: false, reason: 'Type action requires a target element', riskLevel: 'medium' }
  }

  if (isPasswordTarget(action) && !action.requiresApproval) {
    return { allowed: false, reason: 'Typing into password fields must require user approval', riskLevel: 'high' }
  }

  return { allowed: true, reason: 'Type action passed all safety checks', riskLevel: 'none' }
}

function isPasswordTarget(action: Action): boolean {
  if (!action.target) return false
  const tag = action.target.tag.toLowerCase()
  const attrs = action.target.attributes
  if (attrs['type'] === 'password') return true
  const nameOrId = (attrs['name'] ?? '') + (attrs['id'] ?? '')
  if (/password|passwd|pwd/i.test(nameOrId)) return true
  if (tag === 'input' && action.target.selector.includes('[type="password"]')) return true
  return false
}

// --- Step validator (includes dependency checks) ---

export function validateStepSafety(step: ActionPlanStep): ActionValidationResult {
  const actionResult = validateActionSafety(step.action)
  if (!actionResult.allowed) return actionResult

  if (step.dependsOn.some(dep => dep >= step.stepNumber)) {
    return { allowed: false, reason: 'Step depends on a later or same step (circular dependency)', riskLevel: 'medium' }
  }

  return actionResult
}

// --- Plan validator ---

export function validatePlanSafety(plan: ActionPlan): PlanValidationResult {
  const results: PlanValidationResult['results'] = []
  let overallRisk: RiskLevel = 'none'
  let allAllowed = true

  for (const step of plan.steps) {
    const result = validateStepSafety(step)
    results.push({ stepNumber: step.stepNumber, result })

    overallRisk = maxRisk(overallRisk, result.riskLevel)
    if (!result.allowed) allAllowed = false
  }

  return { allowed: allAllowed, results, overallRisk }
}
