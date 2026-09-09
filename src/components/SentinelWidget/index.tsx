import { useState, useEffect, useRef, useCallback } from 'react'
import type { ActionPlan, AgentSession, ActionPlanStep } from '../../types/agent'
import { PromptProcessor } from '../../services/prompt-processor'
import type { ProgressEvent, PageSourceProvider } from '../../services/prompt-processor'
import { ActionExecutor, MockDOMBridge, SUBMISSION_REQUIRES_USER_APPROVAL } from '../../services/action-executor'
import { isExtension, ExtensionDOMBridge } from '../../services/extension-bridge'
import { initQwen } from '../../services/qwen-planner'
import { selectLLMProvider, isWebGpuAvailable } from '../../services/llm-provider-selector'
import {
  hasVaultCredentials,
  saveVaultCredentials,
  loadVaultCredentials,
  matchVaultField,
  type VaultCredentials,
} from '../../services/token-vault'

// ─── Widget-local state type ──────────────────────────────────────────────

type WidgetState =
  | 'setup'
  | 'ready'
  | 'understanding'
  | 'observing'
  | 'planning'
  | 'acting'
  | 'awaiting-approval'
  | 'paused'
  | 'completed'
  | 'error'

interface Message {
  id: string
  role: 'user' | 'sentinel' | 'system'
  content: string
  timestamp: number
}

interface ConfirmationRequest {
  action: string
  description: string
  risk: 'low' | 'medium' | 'high'
  site: string
  plan: ActionPlan | null
  piiCount: number
  injectionsBlocked: number
}

interface CompletionSummary {
  summary: string
  actions: string[]
  durationMs: number
}

interface FillValueRequest {
  stepNumber: number
  description: string
  selector: string
  isPassword: boolean
  vaultDefault?: string  // pre-populated from vault; user can confirm or override
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function formatTime(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function formatTimestamp(ts: number): string {
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
}

function buildPlanMessage(piiCount: number, plan: ActionPlan): string {
  const parts: string[] = []
  if (piiCount > 0) {
    parts.push(`Scanned the page — found ${piiCount} sensitive item${piiCount !== 1 ? 's' : ''} (kept local, never sent anywhere).`)
  }
  if (plan.sanitizationSummary.injectionsBlocked > 0) {
    parts.push(`Blocked ${plan.sanitizationSummary.injectionsBlocked} injection attempt${plan.sanitizationSummary.injectionsBlocked !== 1 ? 's' : ''}.`)
  }
  parts.push(`Ready with a ${plan.steps.length}-step plan. Review and approve to continue.`)
  if (plan.warnings.length > 0 && !plan.warnings[0].includes('redacted')) {
    parts.push(`Note: ${plan.warnings[0]}`)
  }
  return parts.join('\n')
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

const WELCOME: Message = {
  id: 'welcome',
  role: 'sentinel',
  content: 'Hi. I\'m Sentinel — your privacy-first browser agent.\n\nI can fill forms, navigate pages, and complete web tasks. Everything runs locally — your data never leaves your device.\n\nWhat would you like me to do?',
  timestamp: Date.now(),
}

// ─── Sub-components ───────────────────────────────────────────────────────

function StatusStrip({ state }: { state: WidgetState }) {
  const labels: Record<WidgetState, string> = {
    setup: 'Setup',
    ready: 'Ready',
    understanding: 'Understanding',
    observing: 'Observing page',
    planning: 'Planning',
    acting: 'Acting',
    'awaiting-approval': 'Awaiting approval',
    paused: 'Paused',
    completed: 'Completed',
    error: 'Error',
  }

  const dotClass: Record<WidgetState, string> = {
    setup: 'approval',
    ready: 'ready',
    understanding: 'running',
    observing: 'running',
    planning: 'running',
    acting: 'running',
    'awaiting-approval': 'approval',
    paused: 'paused',
    completed: 'done',
    error: 'error',
  }

  return (
    <div className="w-status-strip">
      <div className={`w-status-dot ${dotClass[state]}`} />
      <span className="w-status-label">{labels[state]}</span>
    </div>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const lines = msg.content.split('\n')

  return (
    <div className={`w-msg ${msg.role}`}>
      <div className="w-msg-bubble">
        {lines.map((line, i) => (
          <span key={i}>
            {line}
            {i < lines.length - 1 && <br />}
          </span>
        ))}
      </div>
      {msg.role !== 'system' && (
        <span className="w-msg-ts">{formatTimestamp(msg.timestamp)}</span>
      )}
    </div>
  )
}

function ActivityCard({ state, detail }: { state: WidgetState; detail?: string }) {
  const labels: Partial<Record<WidgetState, string>> = {
    understanding: 'Understanding your request...',
    observing: 'Scanning the current page...',
    planning: 'Building action plan...',
    acting: 'Executing actions...',
  }
  const label = labels[state]
  if (!label) return null

  return (
    <div className="w-activity">
      <div className="w-activity-dots">
        <span /><span /><span />
      </div>
      <div>
        <span className="w-activity-text">{label}</span>
        {detail && (
          <div style={{ fontSize: 10, color: 'var(--wt-3)', marginTop: 2 }}>{detail}</div>
        )}
      </div>
    </div>
  )
}

function ConfirmationCard({
  req,
  onApprove,
  onDecline,
}: {
  req: ConfirmationRequest
  onApprove: () => void
  onDecline: () => void
}) {
  const icons = { low: '✓', medium: '⚡', high: '⚠' }

  return (
    <div className="w-confirm">
      <div className="w-confirm-header">
        <div className={`w-confirm-icon ${req.risk}`}>
          {icons[req.risk]}
        </div>
        <div className="w-confirm-title">Review Plan</div>
      </div>

      <div className="w-confirm-desc">{req.description}</div>

      <div>
        <div className="w-confirm-row">
          <span className="w-confirm-key">Site</span>
          <span style={{ fontSize: 12, color: 'var(--wt-2)', fontFamily: 'var(--mono)' }}>{req.site}</span>
        </div>
        <div className="w-confirm-row">
          <span className="w-confirm-key">Risk level</span>
          <span className={`w-risk-badge ${req.risk}`}>{req.risk}</span>
        </div>
        {req.piiCount > 0 && (
          <div className="w-confirm-row">
            <span className="w-confirm-key">PII detected</span>
            <span style={{ fontSize: 12, color: 'var(--wt-2)' }}>{req.piiCount} item{req.piiCount !== 1 ? 's' : ''} — redacted locally</span>
          </div>
        )}
        {req.injectionsBlocked > 0 && (
          <div className="w-confirm-row">
            <span className="w-confirm-key">Injections</span>
            <span style={{ fontSize: 12, color: '#c4a46b' }}>{req.injectionsBlocked} blocked</span>
          </div>
        )}
      </div>

      {req.plan && req.plan.steps.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--wt-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            {req.plan.steps.length} proposed action{req.plan.steps.length !== 1 ? 's' : ''}
          </div>
          {req.plan.steps.slice(0, 6).map(step => (
            <div key={step.stepNumber} style={{ display: 'flex', gap: 8, marginBottom: 5, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 10, color: 'var(--wt-3)', background: 'var(--wb-3)', borderRadius: 3, padding: '1px 5px', flexShrink: 0, marginTop: 1, minWidth: 18, textAlign: 'center' }}>
                {step.stepNumber}
              </span>
              <span style={{ fontSize: 12, color: 'var(--wt-2)', lineHeight: 1.4 }}>{step.action.description}</span>
            </div>
          ))}
          {req.plan.steps.length > 6 && (
            <div style={{ fontSize: 11, color: 'var(--wt-3)', marginTop: 2 }}>
              +{req.plan.steps.length - 6} more action{req.plan.steps.length - 6 !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {req.plan?.warnings && req.plan.warnings.filter(w => !w.includes('redacted')).length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#c4a46b', background: 'rgba(196,164,107,0.08)', borderRadius: 5, padding: '6px 8px' }}>
          {req.plan.warnings.filter(w => !w.includes('redacted'))[0]}
        </div>
      )}

      <div className="w-confirm-btns">
        <button className="w-btn w-btn-ghost w-btn-sm" onClick={onDecline}>
          Cancel
        </button>
        <button className="w-btn w-btn-primary w-btn-sm" onClick={onApprove}>
          Allow once
        </button>
      </div>
    </div>
  )
}

function CompletionCard({
  summary,
  onNewTask,
}: {
  summary: CompletionSummary
  onNewTask: () => void
}) {
  return (
    <div className="w-completion">
      <div className="w-completion-header">
        <span className="w-completion-icon">✓</span>
        <span className="w-completion-title">Task Completed</span>
      </div>

      <div className="w-completion-summary">{summary.summary}</div>

      <div className="w-completion-actions">
        {summary.actions.map((a, i) => (
          <div key={i} className="w-completion-action-item">{a}</div>
        ))}
      </div>

      <div className="w-completion-footer">
        <span className="w-completion-time">{formatTime(summary.durationMs)}</span>
        <button className="w-btn w-btn-ghost w-btn-sm" onClick={onNewTask}>
          New task
        </button>
      </div>
    </div>
  )
}

function ErrorCard({
  message,
  onRetry,
  onDismiss,
}: {
  message: string
  onRetry: () => void
  onDismiss: () => void
}) {
  return (
    <div className="w-error">
      <div className="w-error-header">
        <span className="w-error-icon">⚠</span>
        <span className="w-error-title">Something went wrong</span>
      </div>
      <div className="w-error-msg">{message}</div>
      <div className="w-error-btns">
        <button className="w-btn w-btn-ghost w-btn-sm" onClick={onDismiss}>
          Dismiss
        </button>
        <button className="w-btn w-btn-primary w-btn-sm" onClick={onRetry}>
          Retry
        </button>
      </div>
    </div>
  )
}

function FillValuesCard({
  requests,
  onSubmit,
  onCancel,
}: {
  requests: FillValueRequest[]
  onSubmit: (values: Record<number, string>) => void
  onCancel: () => void
}) {
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(requests.map(r => [r.stepNumber, r.vaultDefault ?? '']))
  )

  const vaultCount = requests.filter(r => !!r.vaultDefault).length

  return (
    <div className="w-confirm">
      <div className="w-confirm-header">
        <div className="w-confirm-icon low">✎</div>
        <div className="w-confirm-title">Values Needed</div>
      </div>
      <div className="w-confirm-desc" style={{ marginBottom: 10 }}>
        {vaultCount > 0
          ? `${vaultCount} value${vaultCount !== 1 ? 's' : ''} pre-filled from your vault — confirm or edit:`
          : `Provide values for ${requests.length} field${requests.length !== 1 ? 's' : ''} before executing:`}
      </div>
      {requests.map(req => (
        <div key={req.stepNumber} style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: 'var(--wt-3)', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
            {req.description}
            {req.vaultDefault && (
              <span style={{ fontSize: 9, color: '#98c379', background: 'rgba(152,195,121,0.12)', borderRadius: 3, padding: '1px 4px' }}>
                vault
              </span>
            )}
          </label>
          <input
            type={req.isPassword ? 'password' : 'text'}
            style={{
              width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 5,
              border: req.vaultDefault ? '1px solid rgba(152,195,121,0.4)' : '1px solid var(--wb-3)',
              background: 'var(--wb-2)', color: 'var(--wt-1)', boxSizing: 'border-box',
            }}
            value={values[req.stepNumber] ?? ''}
            onChange={e => setValues(prev => ({ ...prev, [req.stepNumber]: e.target.value }))}
            placeholder={req.isPassword ? '••••••••' : 'Enter value…'}
            autoComplete={req.isPassword ? 'current-password' : 'off'}
          />
        </div>
      ))}
      <div className="w-confirm-btns">
        <button className="w-btn w-btn-ghost w-btn-sm" onClick={onCancel}>Cancel</button>
        <button className="w-btn w-btn-primary w-btn-sm" onClick={() => onSubmit(values)}>
          Proceed
        </button>
      </div>
    </div>
  )
}

function SetupCard({ onSave }: { onSave: (creds: VaultCredentials) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [savePassword, setSavePassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const handleSubmit = async () => {
    const errs: string[] = []
    if (!name.trim()) errs.push('Name is required')
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) errs.push('Valid email is required')
    if (!phone.trim()) errs.push('Phone number is required')
    if (errs.length > 0) { setErrors(errs); return }
    setErrors([])
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password: savePassword && password ? password : undefined,
        googleLinked: false,
        savedAt: Date.now(),
      })
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 5,
    border: '1px solid var(--wb-3)', background: 'var(--wb-2)',
    color: 'var(--wt-1)', boxSizing: 'border-box', marginTop: 3,
  }
  const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--wt-3)', display: 'block' }
  const fieldStyle: React.CSSProperties = { marginBottom: 10 }

  return (
    <div className="w-confirm">
      <div className="w-confirm-header">
        <div className="w-confirm-icon low" style={{ fontSize: 16 }}>🔐</div>
        <div className="w-confirm-title">One-time Setup</div>
      </div>
      <div className="w-confirm-desc" style={{ marginBottom: 12 }}>
        Store your credentials locally — encrypted with AES-256, never sent anywhere. Sentinel will auto-fill forms for you.
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Your name *</label>
        <input style={inputStyle} type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" autoComplete="name" />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Email address *</label>
        <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Phone / mobile *</label>
        <input style={inputStyle} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" autoComplete="tel" />
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={savePassword} onChange={e => setSavePassword(e.target.checked)} />
          Save password for auto-fill (optional)
        </label>
        {savePassword && (
          <input style={{ ...inputStyle, marginTop: 6 }} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
        )}
      </div>

      {errors.length > 0 && (
        <div style={{ fontSize: 11, color: '#e06c75', background: 'rgba(224,108,117,0.1)', borderRadius: 5, padding: '5px 8px', marginBottom: 8 }}>
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      <div style={{ fontSize: 10, color: 'var(--wt-3)', marginBottom: 10 }}>
        Encrypted locally · Stored in IndexedDB + chrome.storage · Never uploaded
      </div>

      <button
        className="w-btn w-btn-primary w-btn-sm"
        style={{ width: '100%' }}
        onClick={handleSubmit}
        disabled={saving}
      >
        {saving ? 'Saving…' : 'Save & Continue'}
      </button>
    </div>
  )
}

// ─── Main widget ──────────────────────────────────────────────────────────

export interface SentinelWidgetProps {
  pageSource?: PageSourceProvider
}

export function SentinelWidget({ pageSource }: SentinelWidgetProps = {}) {
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [agentState, setAgentState] = useState<WidgetState>('setup')
  const [inputValue, setInputValue] = useState('')
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const [fillRequests, setFillRequests] = useState<FillValueRequest[]>([])
  const [completion, setCompletion] = useState<CompletionSummary | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [activityDetail, setActivityDetail] = useState<string>('')

  const taskStartRef = useRef<number>(0)
  const lastPromptRef = useRef<string>('')
  const abortControllerRef = useRef<AbortController | null>(null)
  const pendingSessionRef = useRef<AgentSession | null>(null)
  const pendingPlanRef = useRef<ActionPlan | null>(null)
  const vaultCredsRef = useRef<VaultCredentials | null>(null)
  const conversationRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // On mount: check if vault credentials exist; skip setup if they do
  useEffect(() => {
    hasVaultCredentials().then(async (exists) => {
      if (exists) {
        vaultCredsRef.current = await loadVaultCredentials()
        setAgentState('ready')
      }
      // else stay in 'setup'
    }).catch(() => setAgentState('ready'))
  }, [])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = conversationRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, agentState, confirmation, completion, errorMessage])

  // Pre-load Qwen3 model in the background; no-op if WebGPU unavailable
  useEffect(() => {
    if (isWebGpuAvailable()) {
      initQwen()
    }
  }, [])

  // Auto-resize textarea
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`
  }, [])

  const addMessage = useCallback((role: Message['role'], content: string): Message => {
    const msg: Message = { id: uid(), role, content, timestamp: Date.now() }
    setMessages(prev => [...prev, msg])
    return msg
  }, [])

  const addSystem = useCallback((content: string) => {
    addMessage('system', content)
  }, [addMessage])

  // ─── Real agent runner via PromptProcessor ────────────────────────────

  const runAgent = useCallback(async (prompt: string) => {
    taskStartRef.current = Date.now()
    pendingSessionRef.current = null

    const controller = new AbortController()
    abortControllerRef.current = controller

    const onThinking = (step: string) => {
      if (!controller.signal.aborted) setActivityDetail(step)
    }

    const llmProvider = selectLLMProvider({ onThinking, signal: controller.signal })
    const processor = new PromptProcessor({ signal: controller.signal, pageSource, llmProvider })

    const unsubscribe = processor.onProgress((event: ProgressEvent) => {
      if (controller.signal.aborted) return

      const { type, phase, message, detail } = event

      if (type === 'phase-change') {
        switch (phase) {
          case 'capturing':
            setAgentState('observing')
            setActivityDetail('Capturing page DOM...')
            break
          case 'scanning':
            setAgentState('observing')
            setActivityDetail('Running privacy scan...')
            break
          case 'sanitizing':
            setAgentState('planning')
            setActivityDetail('Redacting sensitive data...')
            break
          case 'processing-prompt':
            setAgentState('planning')
            setActivityDetail('Generating action plan...')
            break
        }
      }

      if (type === 'thinking') {
        setActivityDetail(message)
      }

      if (type === 'step-complete' && detail) {
        addSystem(detail)
      }
    })

    setAgentState('understanding')
    setActivityDetail('Analyzing your request...')

    try {
      const session = await processor.process(prompt)

      if (controller.signal.aborted) return

      if (session.state.phase === 'awaiting-approval' && session.state.plan) {
        const plan = session.state.plan
        const risk = (plan.riskLevel as 'low' | 'medium' | 'high') || 'medium'
        const site = session.state.sanitizedPage?.url
          ? safeHostname(session.state.sanitizedPage.url)
          : 'current page'
        const piiCount = session.piiMatches.length
        const injectionsBlocked = plan.sanitizationSummary.injectionsBlocked

        pendingSessionRef.current = session
        addMessage('sentinel', buildPlanMessage(piiCount, plan))
        setAgentState('awaiting-approval')
        setActivityDetail('')
        setConfirmation({
          action: `${plan.steps.length} action${plan.steps.length !== 1 ? 's' : ''} proposed`,
          description: plan.reasoning.length > 140
            ? plan.reasoning.slice(0, 140) + '…'
            : plan.reasoning,
          risk,
          site,
          plan,
          piiCount,
          injectionsBlocked,
        })
      } else if (session.state.phase === 'error') {
        setErrorMessage(session.state.error ?? 'An error occurred during processing.')
        setAgentState('error')
        setActivityDetail('')
      } else if (session.state.phase === 'cancelled') {
        setAgentState('ready')
        setActivityDetail('')
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred.')
        setAgentState('error')
        setActivityDetail('')
      }
    } finally {
      unsubscribe()
    }
  }, [addMessage, addSystem])

  // ─── Handlers ─────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    const text = inputValue.trim()
    if (!text || agentState !== 'ready') return

    lastPromptRef.current = text
    setInputValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    addMessage('user', text)
    void runAgent(text)
  }, [inputValue, agentState, addMessage, runAgent])

  // ─── Core execution (called after fill values are collected) ─────────────
  const executeApprovedPlan = useCallback(async (
    plan: ActionPlan,
    fillValues: Record<number, string>,
  ) => {
    setAgentState('acting')
    setActivityDetail('')
    addSystem(`Executing ${plan.steps.length} action${plan.steps.length !== 1 ? 's' : ''}...`)

    // Inject user-provided values into fill/type steps that had value: null
    const enrichedSteps: ActionPlanStep[] = plan.steps.map(step => {
      const userValue = fillValues[step.stepNumber]
      if (!userValue) return step
      return {
        ...step,
        action: {
          ...step.action,
          value: userValue,
          // Mark as user-provided so the password guard allows it
          target: step.action.target
            ? { ...step.action.target, attributes: { ...step.action.target.attributes, 'data-value-source': 'user-provided' } }
            : null,
        },
      }
    })
    const enrichedPlan: ActionPlan = { ...plan, steps: enrichedSteps }

    const bridge = isExtension() ? new ExtensionDOMBridge() : new MockDOMBridge()
    const allSteps = new Set(plan.steps.map(s => s.stepNumber))
    const executor = new ActionExecutor({
      bridge,
      signal: abortControllerRef.current?.signal,
      approvedSteps: allSteps,
    })

    executor.onExecution((record) => {
      const icon = record.result.status === 'completed' ? 'OK' : 'FAIL'
      const errMsg = record.result.error ? ` — ${record.result.error}` : ''
      addSystem(`[${icon}] Step ${record.stepNumber}: ${record.action.description}${errMsg}`)

      if (
        record.action.type === 'extract' &&
        record.result.status === 'completed' &&
        record.result.detail
      ) {
        addMessage('sentinel', `Extracted content:\n${record.result.detail}`)
      }

      setActivityDetail(`Step ${record.stepNumber}/${plan.steps.length}: ${record.action.description}`)
    })

    try {
      const result = await executor.executePlan(enrichedPlan)

      if (abortControllerRef.current?.signal.aborted) return

      const duration = Date.now() - taskStartRef.current
      const completedActions = result.records
        .filter(r => r.result.status === 'completed')
        .map(r => r.action.description)
      const failedCount = result.records.filter(r => r.result.status === 'failed').length

      if (result.status === 'blocked' && result.stoppedReason === SUBMISSION_REQUIRES_USER_APPROVAL) {
        addMessage('sentinel', `Plan paused before form submission. ${completedActions.length} step${completedActions.length !== 1 ? 's' : ''} completed. To resubmit, start a new task.`)
        setAgentState('completed')
        setCompletion({
          summary: `Paused before submit — ${completedActions.length} step${completedActions.length !== 1 ? 's' : ''} completed`,
          actions: completedActions.length > 0 ? completedActions : ['No actions completed'],
          durationMs: duration,
        })
        return
      }

      setAgentState('completed')
      setCompletion({
        summary: result.status === 'completed'
          ? `Completed: "${lastPromptRef.current.slice(0, 60)}${lastPromptRef.current.length > 60 ? '…' : ''}"`
          : `Stopped (${failedCount} failed): "${lastPromptRef.current.slice(0, 50)}…"`,
        actions: completedActions.length > 0 ? completedActions : ['No actions completed'],
        durationMs: duration,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setErrorMessage(err instanceof Error ? err.message : 'Execution failed')
      setAgentState('error')
    }
  }, [addMessage, addSystem])

  const handleSetupSave = useCallback(async (creds: VaultCredentials) => {
    await saveVaultCredentials(creds)
    vaultCredsRef.current = creds
    setAgentState('ready')
  }, [])

  const handleApprove = useCallback(() => {
    const session = pendingSessionRef.current
    const plan = session?.state.plan
    setConfirmation(null)

    if (!plan) {
      addSystem('No plan to execute.')
      setAgentState('ready')
      return
    }

    // Reload vault creds from ref (set on mount or after setup); try async reload
    // if missing so a page refresh doesn't lose pre-fill
    const doApprove = (vaultCreds: VaultCredentials | null) => {
      // Collect fill/type steps that still need a value
      const nullFillSteps = plan.steps.filter(
        s => (s.action.type === 'fill' || s.action.type === 'type') && !s.action.value
      )

      if (nullFillSteps.length === 0) {
        pendingPlanRef.current = plan
        void executeApprovedPlan(plan, {})
        return
      }

      // Map each step to its vault-matched value (may be null)
      const vaultFilled: Record<number, string> = {}
      const requests: FillValueRequest[] = nullFillSteps.map(s => {
        const vaultValue = vaultCreds ? matchVaultField(s.action.description, vaultCreds) : null
        if (vaultValue) vaultFilled[s.stepNumber] = vaultValue
        return {
          stepNumber: s.stepNumber,
          description: s.action.description,
          selector: s.action.target?.selector ?? '',
          isPassword: /password|passwd|pwd/i.test(s.action.target?.selector ?? '') ||
                      /password/i.test(s.action.description),
          vaultDefault: vaultValue ?? undefined,
        }
      })

      // If ALL fields are covered by vault, skip FillValuesCard and execute directly
      const allCovered = requests.every(r => !!r.vaultDefault)
      if (allCovered) {
        pendingPlanRef.current = plan
        void executeApprovedPlan(plan, vaultFilled)
        return
      }

      // Some fields need user input — show FillValuesCard with vault defaults pre-filled
      ;(pendingPlanRef as React.MutableRefObject<ActionPlan & { _vaultFilled?: Record<number, string> } | null>).current = { ...plan, _vaultFilled: vaultFilled }
      setFillRequests(requests)
    }

    if (vaultCredsRef.current) {
      doApprove(vaultCredsRef.current)
    } else {
      // Vault creds not in memory — try reloading from storage (handles page reload case)
      loadVaultCredentials().then(creds => {
        if (creds) vaultCredsRef.current = creds
        doApprove(creds)
      }).catch(() => doApprove(null))
    }
  }, [addSystem, executeApprovedPlan])

  const handleFillValuesSubmit = useCallback((values: Record<number, string>) => {
    const plan = pendingPlanRef.current as (ActionPlan & { _vaultFilled?: Record<number, string> }) | null
    setFillRequests([])
    if (!plan) { setAgentState('ready'); return }
    // Merge vault-pre-filled values with user-entered values; user values win
    const merged: Record<number, string> = { ...(plan._vaultFilled ?? {}), ...values }
    const cleanPlan: ActionPlan = { ...plan }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (cleanPlan as any)._vaultFilled
    void executeApprovedPlan(cleanPlan, merged)
  }, [executeApprovedPlan])

  const handleFillValuesCancel = useCallback(() => {
    setFillRequests([])
    pendingPlanRef.current = null
    pendingSessionRef.current = null
    setAgentState('ready')
    addMessage('sentinel', 'Cancelled. What else can I help you with?')
  }, [addMessage])

  const handleDecline = useCallback(() => {
    setConfirmation(null)
    pendingSessionRef.current = null
    setAgentState('ready')
    addMessage('sentinel', 'Understood — I won\'t proceed. What else can I help you with?')
  }, [addMessage])

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort()
    setConfirmation(null)
    setFillRequests([])
    setCompletion(null)
    setActivityDetail('')
    pendingSessionRef.current = null
    pendingPlanRef.current = null
    setAgentState('ready')
    addMessage('sentinel', 'Stopped. Ready for a new task.')
  }, [addMessage])

  const handlePause = useCallback(() => {
    abortControllerRef.current?.abort()
    setActivityDetail('')
    setAgentState('paused')
    addSystem('Paused.')
  }, [addSystem])

  const handleResume = useCallback(() => {
    if (agentState !== 'paused' || !lastPromptRef.current) return
    addSystem('Restarting...')
    void runAgent(lastPromptRef.current)
  }, [agentState, addSystem, runAgent])

  const handleRetry = useCallback(() => {
    setErrorMessage(null)
    setActivityDetail('')
    setAgentState('ready')
    if (lastPromptRef.current) {
      addMessage('user', lastPromptRef.current)
      void runAgent(lastPromptRef.current)
    }
  }, [addMessage, runAgent])

  const handleDismissError = useCallback(() => {
    setErrorMessage(null)
    setActivityDetail('')
    setAgentState('ready')
  }, [])

  const handleNewTask = useCallback(() => {
    setCompletion(null)
    pendingSessionRef.current = null
    setAgentState('ready')
    textareaRef.current?.focus()
  }, [])

  const handleClear = useCallback(() => {
    abortControllerRef.current?.abort()
    setMessages([WELCOME])
    setAgentState('ready')
    setConfirmation(null)
    setFillRequests([])
    setCompletion(null)
    setErrorMessage(null)
    setActivityDetail('')
    pendingSessionRef.current = null
    pendingPlanRef.current = null
    lastPromptRef.current = ''
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // ─── Derived flags ────────────────────────────────────────────────────

  const isRunning = agentState === 'understanding' || agentState === 'observing'
    || agentState === 'planning' || agentState === 'acting'
  const canInput = agentState === 'ready'
  const showActivity = isRunning
  const showPauseResume = isRunning || agentState === 'paused'

  if (agentState === 'setup') {
    return (
      <div id="sentinel-widget-root">
        <StatusStrip state={agentState} />
        <div className="w-conversation" ref={conversationRef}>
          <SetupCard onSave={handleSetupSave} />
        </div>
      </div>
    )
  }

  return (
    <div id="sentinel-widget-root">

      {/* Status strip */}
      <StatusStrip state={agentState} />

      {/* Conversation */}
      <div className="w-conversation" ref={conversationRef}>
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {showActivity && <ActivityCard state={agentState} detail={activityDetail} />}

        {confirmation && (
          <ConfirmationCard
            req={confirmation}
            onApprove={handleApprove}
            onDecline={handleDecline}
          />
        )}

        {fillRequests.length > 0 && (
          <FillValuesCard
            requests={fillRequests}
            onSubmit={handleFillValuesSubmit}
            onCancel={handleFillValuesCancel}
          />
        )}

        {completion && !isRunning && (
          <CompletionCard summary={completion} onNewTask={handleNewTask} />
        )}

        {errorMessage && (
          <ErrorCard
            message={errorMessage}
            onRetry={handleRetry}
            onDismiss={handleDismissError}
          />
        )}
      </div>

      {/* Running controls */}
      {showPauseResume && (
        <div className="w-action-controls">
          {agentState === 'paused' ? (
            <button className="w-btn w-btn-ghost w-btn-sm" onClick={handleResume}>
              ▶ Resume
            </button>
          ) : (
            <button className="w-btn w-btn-ghost w-btn-sm" onClick={handlePause}>
              ⏸ Pause
            </button>
          )}
          <button className="w-btn w-btn-danger w-btn-sm" onClick={handleStop}>
            ■ Stop
          </button>
        </div>
      )}

      {/* Prompt input */}
      <div className="w-input-area">
        <div className="w-input-row">
          <textarea
            ref={textareaRef}
            className="w-textarea"
            rows={1}
            placeholder="Tell Sentinel what you want to do…"
            value={inputValue}
            disabled={!canInput}
            onChange={e => {
              setInputValue(e.target.value)
              resizeTextarea()
            }}
            onKeyDown={handleKeyDown}
          />
          <button
            className="w-send-btn"
            onClick={handleSend}
            disabled={!canInput || !inputValue.trim()}
            title="Send (Enter)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M14.5 8L2 2l2.5 6L2 14l12.5-6z" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="w-input-hint">Enter to send · Shift+Enter for newline</span>
          {messages.length > 1 && (
            <button
              className="w-btn w-btn-ghost w-btn-sm"
              style={{ fontSize: 10, padding: '3px 7px' }}
              onClick={handleClear}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
