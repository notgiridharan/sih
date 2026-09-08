import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────

type AgentState =
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
}

interface CompletionSummary {
  summary: string
  actions: string[]
  durationMs: number
}

// ─── Mock scenario builder ────────────────────────────────────────────────

function buildMockScenario(prompt: string): {
  sentinelReply: string
  confirmation: ConfirmationRequest
  completionActions: string[]
} {
  const lower = prompt.toLowerCase()

  if (/book|ticket|flight|train|bus|travel/.test(lower)) {
    return {
      sentinelReply: 'I can see a booking form on this page. I\'ll fill in the details and proceed to checkout.',
      confirmation: {
        action: 'Complete booking',
        description: 'Sentinel will fill the booking form and submit your reservation.',
        risk: 'high',
        site: window.location.hostname || 'current page',
      },
      completionActions: ['Opened booking form', 'Filled passenger details', 'Selected travel class', 'Navigated to payment'],
    }
  }

  if (/login|sign in|account|password/.test(lower)) {
    return {
      sentinelReply: 'I found a login form. I\'ll use your saved credentials to sign in.',
      confirmation: {
        action: 'Fill login form',
        description: 'Sentinel will enter credentials into the sign-in form.',
        risk: 'high',
        site: window.location.hostname || 'current page',
      },
      completionActions: ['Located login form', 'Filled username field', 'Filled password field', 'Submitted form'],
    }
  }

  if (/search|find|look for|show me/.test(lower)) {
    return {
      sentinelReply: 'I\'ll search the page for what you\'re looking for.',
      confirmation: {
        action: 'Perform search',
        description: 'Sentinel will enter your search query and navigate to the results.',
        risk: 'low',
        site: window.location.hostname || 'current page',
      },
      completionActions: ['Located search field', 'Entered search query', 'Submitted search', 'Results loaded'],
    }
  }

  if (/fill|form|submit|send/.test(lower)) {
    return {
      sentinelReply: 'I found a form on this page. I\'ll fill it out based on your instructions.',
      confirmation: {
        action: 'Fill and submit form',
        description: 'Sentinel will complete and submit the form on this page.',
        risk: 'medium',
        site: window.location.hostname || 'current page',
      },
      completionActions: ['Identified form fields', 'Filled required fields', 'Validated entries', 'Submitted form'],
    }
  }

  // Default
  return {
    sentinelReply: 'I\'ve analyzed the page and identified the steps needed. Ready to proceed on your confirmation.',
    confirmation: {
      action: 'Perform web action',
      description: `Sentinel will execute the requested action on this page.`,
      risk: 'medium',
      site: window.location.hostname || 'current page',
    },
    completionActions: ['Analyzed page structure', 'Identified target elements', 'Executed action', 'Verified result'],
  }
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

const WELCOME: Message = {
  id: 'welcome',
  role: 'sentinel',
  content: 'Hi. I\'m Sentinel — your privacy-first browser agent.\n\nI can fill forms, navigate pages, and complete web tasks while keeping your data local and secure.\n\nWhat would you like me to do?',
  timestamp: Date.now(),
}

// ─── Sub-components ───────────────────────────────────────────────────────

function StatusStrip({ state }: { state: AgentState }) {
  const labels: Record<AgentState, string> = {
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

  const dotClass: Record<AgentState, string> = {
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

function ActivityCard({ state }: { state: AgentState }) {
  const labels: Partial<Record<AgentState, string>> = {
    understanding: 'Understanding your request...',
    observing: 'Examining the current page...',
    planning: 'Determining best approach...',
    acting: 'Executing action...',
  }
  const label = labels[state]
  if (!label) return null

  return (
    <div className="w-activity">
      <div className="w-activity-dots">
        <span /><span /><span />
      </div>
      <span className="w-activity-text">{label}</span>
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
        <div className="w-confirm-title">Confirmation Required</div>
      </div>

      <div className="w-confirm-desc">{req.description}</div>

      <div>
        <div className="w-confirm-row">
          <span className="w-confirm-key">Action</span>
          <span style={{ fontSize: 12, color: 'var(--wt-2)' }}>{req.action}</span>
        </div>
        <div className="w-confirm-row">
          <span className="w-confirm-key">Site</span>
          <span style={{ fontSize: 12, color: 'var(--wt-2)', fontFamily: 'var(--mono)' }}>{req.site}</span>
        </div>
        <div className="w-confirm-row">
          <span className="w-confirm-key">Risk level</span>
          <span className={`w-risk-badge ${req.risk}`}>{req.risk}</span>
        </div>
      </div>

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

// ─── Main widget ──────────────────────────────────────────────────────────

export function SentinelWidget() {
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [agentState, setAgentState] = useState<AgentState>('ready')
  const [inputValue, setInputValue] = useState('')
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const [completion, setCompletion] = useState<CompletionSummary | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const taskStartRef = useRef<number>(0)
  const lastPromptRef = useRef<string>('')
  const abortRef = useRef<boolean>(false)
  const conversationRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = conversationRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, agentState, confirmation, completion, errorMessage])

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

  // ─── Mock agent runner ─────────────────────────────────────────────────

  const runMockAgent = useCallback(async (prompt: string) => {
    abortRef.current = false
    taskStartRef.current = Date.now()
    const scenario = buildMockScenario(prompt)

    const sleep = (ms: number) => new Promise<void>((resolve) => {
      setTimeout(() => { if (!abortRef.current) resolve() }, ms)
    })

    // Phase: understanding
    setAgentState('understanding')
    await sleep(700)
    if (abortRef.current) return

    // Phase: observing
    setAgentState('observing')
    addSystem('Scanning page...')
    await sleep(1000)
    if (abortRef.current) return

    // Phase: planning
    setAgentState('planning')
    addSystem('Analyzing structure...')
    await sleep(900)
    if (abortRef.current) return

    // Sentinel response + await approval
    addMessage('sentinel', scenario.sentinelReply)
    setAgentState('awaiting-approval')
    setConfirmation(scenario.confirmation)
  }, [addMessage, addSystem])

  // ─── Handlers ─────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    const text = inputValue.trim()
    if (!text || agentState !== 'ready') return

    lastPromptRef.current = text
    setInputValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    addMessage('user', text)
    void runMockAgent(text)
  }, [inputValue, agentState, addMessage, runMockAgent])

  const handleApprove = useCallback(async () => {
    setConfirmation(null)
    setAgentState('acting')
    addSystem('Executing...')

    await new Promise<void>(resolve => setTimeout(resolve, 1400))
    if (abortRef.current) return

    const duration = Date.now() - taskStartRef.current
    const scenario = buildMockScenario(lastPromptRef.current)

    setAgentState('completed')
    setCompletion({
      summary: `Successfully completed: "${lastPromptRef.current.slice(0, 60)}${lastPromptRef.current.length > 60 ? '…' : ''}"`,
      actions: scenario.completionActions,
      durationMs: duration,
    })
  }, [addSystem])

  const handleDecline = useCallback(() => {
    setConfirmation(null)
    setAgentState('ready')
    addMessage('sentinel', 'Understood — I won\'t proceed. What else can I help you with?')
  }, [addMessage])

  const handlePause = useCallback(() => {
    if (agentState !== 'acting' && agentState !== 'understanding' && agentState !== 'observing' && agentState !== 'planning') return
    abortRef.current = true
    setAgentState('paused')
    addSystem('Paused')
  }, [agentState, addSystem])

  const handleResume = useCallback(() => {
    if (agentState !== 'paused') return
    abortRef.current = false
    addSystem('Resuming...')
    void runMockAgent(lastPromptRef.current)
  }, [agentState, addSystem, runMockAgent])

  const handleStop = useCallback(() => {
    abortRef.current = true
    setConfirmation(null)
    setAgentState('ready')
    addMessage('sentinel', 'Stopped. Ready for a new task.')
  }, [addMessage])

  const handleRetry = useCallback(() => {
    setErrorMessage(null)
    setAgentState('ready')
    if (lastPromptRef.current) {
      void runMockAgent(lastPromptRef.current)
    }
  }, [runMockAgent])

  const handleDismissError = useCallback(() => {
    setErrorMessage(null)
    setAgentState('ready')
  }, [])

  const handleNewTask = useCallback(() => {
    setCompletion(null)
    setAgentState('ready')
    textareaRef.current?.focus()
  }, [])

  const handleClear = useCallback(() => {
    abortRef.current = true
    setMessages([WELCOME])
    setAgentState('ready')
    setConfirmation(null)
    setCompletion(null)
    setErrorMessage(null)
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

  return (
    <div id="sentinel-widget-root">

      {/* Status strip */}
      <StatusStrip state={agentState} />

      {/* Conversation */}
      <div className="w-conversation" ref={conversationRef}>
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {showActivity && <ActivityCard state={agentState} />}

        {confirmation && (
          <ConfirmationCard
            req={confirmation}
            onApprove={handleApprove}
            onDecline={handleDecline}
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
