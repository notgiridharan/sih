# Sentinel Lens ↔ Browser Use Architectural Analysis

**Date:** 2026-09-08  
**Status:** READ-ONLY analysis. No code modifications in this document.  
**Context:** Comparing Sentinel's existing privacy-preserving architecture against Browser Use reference files to determine exact adaptation points for agent loop implementation.

---

## Executive Summary

**Sentinel's strength:** Comprehensive privacy pipeline (PII detection, prompt injection blocking, sanitization, redaction mapping). All sensitive data is never exposed to the LLM.

**Sentinel's gap:** No agent loop, no real DOMBridge, no element indexing, no re-observation after actions, no action-generated content visibility to next step.

**Browser Use's strength:** Clean agent loop (Observe→Think→Act→Re-observe), numeric element indexing, action result propagation to next step via `ActionResult.extracted_content`, modular architecture.

**Browser Use's gap:** No privacy-preserving redaction; assumes untrusted LLM but local execution.

**Adaptation strategy:** Integrate Browser Use's agent loop + element indexing + action propagation INTO Sentinel's privacy pipeline, without replacing any existing services. The result: a privacy-preserving agent that stays invisible while automating.

---

## Detailed Component Comparison

### 1. Element Targeting: CSS Selectors → Numeric Indexes

**Current Sentinel**
```typescript
// src/types/agent.ts
export interface ActionTarget {
  selector: string       // CSS selector, e.g., "#email-input"
  tag: string           // "input"
  description: string   // "Email field"
  attributes: Record<string, string>
}

export interface Action {
  target: ActionTarget | null
  // LLM sees the selector directly
}
```

**Browser Use Model**
```python
# src/browser-use-reference/tools/views.py
class ClickElementAction(BaseModel):
  index: int  # 1-based, e.g., 3
  # Browser_state shows: [3]<input type=email placeholder=Email />
```

**Why Browser Use's approach is superior:**
- Selectors break on DOM mutations; indexes are regenerated per step
- Selectors can fail (e.g., `#email-1` then `#email-2` after reload)
- Numeric indexes force re-observation after every action (page might have changed)
- Smaller LLM prompt: `[3]` vs `#form > div:nth-child(2) > input.email-field`

**Recommended Sentinel Adaptation**

| Component | Current | Browser Use Concept | Sentinel Adaptation | Reuse/Extend/Replace | Reason |
|---|---|---|---|---|
| **Action.target** | CSS selector | Numeric index | Keep selector for ActionExecutor, ADD index field for LLM | **Extend** | LLM uses index in prompt; ActionExecutor maps index→selector at execution time |
| **ActionTarget.selector** | CSS string | N/A (index replaces it) | KEEP as is; add `index: number` field to ActionTarget | **Extend** | Maintain backward compatibility with ActionExecutor; new AgentLoop will use index |
| **DOM serialization** | Raw HTML string | `[N]<tag attr>text` format | Add IndexedDOMElement interface with number + selector mapping | **Extend** | Create DOMSelectorMap: `Map<number, {selector, tag, text, attributes}>` |
| **Element detection** | N/A (not done yet) | `is_interactive()` heuristic | Port clickable_elements.py to TypeScript, operate on real DOM Elements in content-script | **Adapt** | Use Browser Use's 150+ line heuristic; replace CDP with DOM API equivalents |

**Implementation Detail:**
```typescript
// New interface (to add to src/types/agent.ts)
export interface IndexedDOMElement {
  index: number           // 1-based index for LLM
  selector: string        // CSS selector for ActionExecutor
  tag: string
  text: string           // Text content only (no HTML)
  attributes: Record<string, string>
  interactivity: 'interactive' | 'readonly' | 'disabled'
}

// Extend ActionTarget
export interface ActionTarget {
  selector: string
  tag: string
  description: string
  attributes: Record<string, string>
  index?: number  // NEW: numeric index used by LLM
}
```

---

### 2. Page State Representation: Raw HTML → Serialized State

**Current Sentinel**
```typescript
// src/types/scan.ts
export interface ScanTarget {
  url: string
  dom: string            // Full outerHTML as string (~100KB for complex pages)
  screenshot: string | null
}

// src/services/scanner.ts::scan()
// Returns ScanResult with piiMatches, promptInjections, sanitizedDOM (full HTML)
```

**Browser Use Model**
```python
# src/browser-use-reference/browser/views.py
@dataclass
class BrowserStateSummary:
  dom_state: SerializedDOMState
  url: str
  title: str
  tabs: list[TabInfo]
  screenshot: str | None
  page_info: PageInfo

# src/browser-use-reference/dom/views.py
@dataclass
class SerializedDOMState:
  # NOT full HTML — only interactive elements in [N]<tag> format
  # Maps: selector_map: Dict[int, DOMElement]
```

**Why Browser Use's approach is superior:**
- Smaller prompt: 2KB indexed elements vs 100KB raw HTML
- Fast re-observation: regenerate indexes without re-scanning for PII
- Element reference is unambiguous: `[3]` cannot refer to two different elements
- Enables action result visibility: "clicked element [3], now available: [3a] (new element), [3b] (new element)"

**Recommended Sentinel Adaptation**

| Component | Current | Browser Use Concept | Sentinel Adaptation | Reuse/Extend/Replace | Reason |
|---|---|---|---|---|
| **Page capture** | Full outerHTML | SerializedDOMState | KEEP full HTML for scanning; ADD indexed serialization for LLM | **Extend** | Two representations: (1) full HTML for scanner, (2) indexed for LLM prompt |
| **DOM state storage** | ScanResult.sanitizedDOM: string | SerializedDOMState object | Create AgentPageState with selector_map: `Map<number, IndexedDOMElement>` | **Extend** | Store indexed state alongside sanitized state in SanitizedPage |
| **Scanner output** | Returns ScanResult | N/A | KEEP scanner output; add post-processing step to extract interactive elements and assign indexes | **Extend** | Scanner runs on full DOM; indexing runs on sanitized interactive elements only |

**Implementation Detail:**
```typescript
// New interface (to add to src/types/agent.ts)
export interface DOMSelectorMap {
  [index: number]: IndexedDOMElement
  // Maps [3] → {selector: '#email', tag: 'input', text: '...', attributes: {...}}
}

export interface SerializedPageState {
  url: string
  title: string
  selectorMap: DOMSelectorMap      // Numeric index → element
  domText: string                   // [3]<input />...[5]<button>... (LLM-readable)
  domHash: string                   // Hash of structure for diffing
  timestamp: number
}

// Extend SanitizedPage
export interface SanitizedPage {
  url: string
  title: string
  sanitizedDOM: string              // KEEP: for scanner's internal use
  structuredContext: string         // KEEP: for LLM context
  redactionMapping: RedactionMapping // KEEP: PII→placeholder map
  sensitiveElements: SensitiveElement[] // KEEP
  scanResult: ScanResult            // KEEP
  capturedAt: number
  // NEW:
  serializedState?: SerializedPageState  // Indexed state for agent loop
}
```

---

### 3. Action Execution: Selector-based → Index-based with Re-observation

**Current Sentinel**
```typescript
// src/services/action-executor.ts
export class ActionExecutor {
  async executeStep(step: ActionPlanStep): Promise<ExecutionRecord> {
    const { action } = step
    const validation = validateActionSafety(action)
    if (!validation.allowed) return { result: failed }
    
    // Execute via selector
    const domResult = await this.bridge.click(action.target.selector)
    
    // NO re-observation: assumes page state unchanged
    // NO action result propagation to next step
  }
}
```

**Browser Use Model**
```python
# src/browser-use-reference/agent/service.py
async def step(self):
  # Observe 1: capture page, serialize to indexed state
  state = await self.get_page_state()  # Calls DOM serializer
  
  # Think: send state to LLM
  response = await self.llm.chat(messages_with_state)
  
  # Act: execute action
  await self.browser.execute_action(response.action)
  
  # Re-observe: capture page AGAIN, serialize to indexed state
  new_state = await self.get_page_state()
  
  # Propagate: action.extracted_content visible in next step's history
```

**Why Browser Use's approach is superior:**
- Page state is always current; detects invisible changes
- Action results (e.g., OTP code from Gmail action) become LLM input immediately
- Handles dynamic UI: newly-appeared elements get fresh indexes
- Prevents "stale element reference" errors

**Recommended Sentinel Adaptation**

| Component | Current | Browser Use Concept | Sentinel Adaptation | Reuse/Extend/Replace | Reason |
|---|---|---|---|---|
| **ActionExecutor** | Executes plan steps sequentially; no re-observation | Observe-Think-Act-Re-observe loop per step | KEEP step execution logic; ADD re-observation + diff after each action | **Extend** | Create wrapper: capture-before, execute (existing code), capture-after, diff |
| **DOMBridge** | Currently mocked | Executes via Playwright CDP | Wire to real content-script handlers; use DOM events not CDP | **Replace** | Build real bridge operating on extension content-script |
| **Action result propagation** | ExecutionRecord.result.detail is static | ActionResult.extracted_content visible in next step | ADD extracted_content to ExecutionRecord; pass to next step's history | **Extend** | When action returns data, make it LLM-visible in step N+1 |
| **State diffing** | None | Detect new/removed/changed elements between states | Compute `SerializedPageState` diff; mark new elements with `*[4]` in next prompt | **Add** | Enables LLM to detect: "I clicked, these elements appeared, should I click one?" |

**Implementation Detail:**
```typescript
// Extend ExecutionRecord (in src/types/agent.ts)
export interface ExecutionRecord {
  stepNumber: number
  action: Action
  validation: ActionValidationResult
  result: ActionExecutionResult
  // NEW:
  stateBefore?: SerializedPageState
  stateAfter?: SerializedPageState
  extractedContent?: string  // From ActionResult.extracted_content
  elementsAppeared?: number[]  // New indexes [4], [5]
  elementsDisappeared?: number[] // Removed indexes [2]
}

// Create new service
export class AgentObserver {
  async observePageState(): Promise<SerializedPageState> {
    const tab = await captureActiveTab()
    const screenshot = await captureScreenshot()
    
    // Use existing scanner
    const scanResult = await scan({...})
    
    // NEW: extract interactive elements and assign indexes
    const selectorMap = await this.indexInteractiveElements(tab.dom)
    
    return {
      url: tab.url,
      title: tab.title,
      selectorMap,
      domText: this.serializeToLLMFormat(selectorMap),
      timestamp: Date.now(),
    }
  }
  
  computeDiff(before: SerializedPageState, after: SerializedPageState): PageStateDiff {
    return {
      appeared: after.selectorMap.keys minus before.selectorMap.keys,
      disappeared: before.selectorMap.keys minus after.selectorMap.keys,
      moved: same index, different selector,
    }
  }
}
```

---

### 4. Action Types: Static → Dynamic with Context Propagation

**Current Sentinel**
```typescript
// src/types/agent.ts
export type ActionType = 'navigate' | 'click' | 'fill' | 'type' | 'focus' | 'wait'

export interface Action {
  type: ActionType
  target: ActionTarget | null
  value: string | null
  // No mechanism for action results to feed into next step
}
```

**Browser Use Model**
```python
# src/browser-use-reference/tools/views.py
class ClickElementAction:
  index: int  # Element reference

class InputTextAction:
  index: int
  text: str

class ScrollAction:
  down: bool
  pages: float  # 1.0 = full page, 0.5 = half

class SendKeysAction:
  keys: str  # "Escape", "Enter", "Control+a"

class DoneAction:
  text: str  # Final output to user
  success: bool

# Critically: actions CAN return extracted_content
# which becomes visible in browser_state for next step
```

**Recommended Sentinel Adaptation**

| Component | Current | Browser Use Concept | Sentinel Adaptation | Reuse/Extend/Replace | Reason |
|---|---|---|---|---|
| **ActionType** | 6 types (navigate, click, fill, type, focus, wait) | 12+ types (includes scroll, send_keys, done, extract) | ADD ScrollAction, SendKeysAction; keep existing types | **Extend** | Sentinel doesn't need 'extract' or 'done' (UI handles those), but scroll/send_keys useful for complex interactions |
| **Action result** | ExecutionRecord only shows success/error | ActionResult.extracted_content | ADD extracted_content field to ExecutionRecord; make LLM-visible | **Extend** | Critical for OTP retrieval: get_recent_emails action returns code in extracted_content |
| **Action safety** | ActionSafetyValidator exists and is comprehensive | Similar but less strict (permissive by design) | KEEP Sentinel's validator unchanged; it's more stringent | **Extend** | Sentinel's 150+ blocked patterns are strict (correct for privacy); don't weaken |
| **Action target** | Always ActionTarget with selector | Can be index OR coordinate | KEEP selector as primary; allow index as alternative | **Extend** | Flexibility for native DOM coordinate interactions |

**Implementation Detail:**
```typescript
// Extend ActionType
export type ActionType = 
  | 'navigate' | 'click' | 'fill' | 'type' | 'focus' | 'wait'
  | 'scroll' | 'send_keys'  // NEW from Browser Use

// New actions (to add to src/types/agent.ts)
export interface ScrollAction extends Action {
  type: 'scroll'
  value: 'up' | 'down'  // or null for by-index scroll
  target: {index?: number, selector?: string}  // scroll within container
}

export interface SendKeysAction extends Action {
  type: 'send_keys'
  value: string  // "Escape", "Enter", "Control+a", "Control+v"
}

// Extend ExecutionResult
export interface ActionExecutionResult {
  actionId: string
  status: ActionStatus
  startedAt: number
  completedAt: number | null
  error: string | null
  detail: string | null
  // NEW: propagate action results to next step
  extractedContent?: string  // e.g., "Email code is 456789"
}
```

---

### 5. Extension Bridge: Screenshot-only → DOM Extraction + Interaction

**Current Sentinel**
```typescript
// extension/background.js
// Handles: CAPTURE_SCREENSHOT (via captureVisibleTab)
// Handles: CAPTURE_ACTIVE_TAB (executes DOM extraction script, returns full HTML)

// extension/content-script.js
// Minimal: responds to PING, responds to CAPTURE_DOM

// src/services/extension-bridge.ts
export async function captureActiveTab(): Promise<TabCapture> {
  // Calls CAPTURE_ACTIVE_TAB → full outerHTML
}
```

**Browser Use Model**
```python
# Browser Use uses Playwright CDP, not extension messaging
# But conceptually: extract DOM, detect interactivity, serialize
```

**Recommended Sentinel Adaptation**

| Component | Current | Browser Use Concept | Sentinel Adaptation | Reuse/Extend/Replace | Reason |
|---|---|---|---|---|
| **Screenshot** | captureVisibleTab() in background.js | Same (Playwright equivalent) | KEEP background.js screenshot handler | **Reuse** | Works well; already reliable |
| **DOM extraction** | Executes document.documentElement.outerHTML in content-script | Would extract full DOM via CDP | KEEP full HTML extraction for scanner | **Reuse** | Scanner needs complete DOM for PII detection |
| **Interactive element detection** | None | Browser Use's is_interactive() on CDP-extracted nodes | PORT is_interactive() to content-script; execute on live DOM Elements | **Adapt** | Content-script can run ClickableElementDetector.is_interactive() on real DOM |
| **Element indexing** | None | Browser Use serializer assigns [N] to interactive elements | Create indexing service in content-script; return: {index, selector, tag, text, attrs} | **Add** | New: index interactive elements; store selector mapping for re-hydration |
| **Action dispatch** | None (MockDOMBridge only) | Playwright executes: click(index), fill(selector, value), etc. | Implement real ActionDispatcher in content-script: click(selector), fill(selector), type(selector), etc. | **Add** | New: content-script handlers for DOM mutations (click, fill, type, navigate, focus) |

**Implementation Detail:**
```typescript
// Extend extension-bridge.ts with new capability

// NEW message types to handle in content-script.js
type ContentScriptMessage =
  | {type: 'CAPTURE_DOM'}               // EXISTING
  | {type: 'PING'}                      // EXISTING
  | {type: 'EXTRACT_INTERACTIVE_DOM'}   // NEW: return indexed elements
  | {type: 'CLICK', selector: string}   // NEW: dispatch DOM click
  | {type: 'FILL', selector: string, value: string}  // NEW
  | {type: 'TYPE', selector: string, text: string}   // NEW
  | {type: 'FOCUS', selector: string}   // NEW
  | {type: 'SCROLL', selector?: string, direction: 'up'|'down', amount: number}  // NEW

// NEW: interactive element extraction (in content-script.js)
function extractInteractiveElements(): IndexedDOMElement[] {
  const elements: IndexedDOMElement[] = []
  let index = 1
  
  for (const el of document.querySelectorAll('*')) {
    if (ClickableElementDetector.is_interactive(el)) {
      elements.push({
        index,
        selector: getCSSPath(el),
        tag: el.tagName.toLowerCase(),
        text: el.textContent?.slice(0, 50) || '',
        attributes: extractAttributes(el),
        interactivity: getInteractivityState(el),
      })
      index++
    }
  }
  
  return elements
}

// NEW: helper to get stable CSS selector
function getCSSPath(el: Element): string {
  if (el.id) return `#${el.id}`
  
  const path = []
  while (el.parentElement) {
    let selector = el.tagName.toLowerCase()
    const siblings = el.parentElement.children
    if (siblings.length > 1) {
      const index = Array.from(siblings).indexOf(el) + 1
      selector += `:nth-child(${index})`
    }
    path.unshift(selector)
    el = el.parentElement
  }
  
  return path.join(' > ')
}
```

---

### 6. Agent Loop: Orchestration Layer (MISSING in Sentinel)

**Current Sentinel**
```typescript
// src/services/prompt-processor.ts
export class PromptProcessor {
  async processPrompt(prompt: string): Promise<AgentSession> {
    // Single linear flow:
    // 1. capture page
    // 2. scan for issues
    // 3. sanitize
    // 4. send to LLM (mock)
    // 5. validate action plan
    // 6. show approval UI
    // 7. execute (via ActionExecutor)
    
    // NO re-observation loop
    // NO step-by-step execution
    // NO action result propagation
  }
}
```

**Browser Use Model**
```python
# src/browser-use-reference/agent/service.py
async def step(self) -> AgentStepInfo:
  # 1. Observe: get current page state
  # 2. Think: send state to LLM
  # 3. Act: execute action from LLM response
  # 4. Re-observe: capture new state, detect changes
  # 5. Return: step info (state before/after, action, result)

# Agent loop (outside this step):
# while goal not achieved:
#   step_info = await agent.step()
#   if step_info.action_result.error: break
#   if step_info.extracted_content: propagate_to_history()
```

**Recommended Sentinel Adaptation**

| Component | Current | Browser Use Concept | Sentinel Adaptation | Reuse/Extend/Replace | Reason |
|---|---|---|---|---|
| **PromptProcessor** | Linear single-pass | N/A (not a loop engine) | KEEP for backward compatibility; create NEW AgentLoop service | **Extend** | PromptProcessor remains for privacy pipeline; AgentLoop orchestrates multi-step execution |
| **Agent step** | None (missing) | Browser Use's step() method | Create AgentStep service: observe→think→act→re-observe | **Add** | Core of agent loop; must support iterative reasoning |
| **Message history** | AgentSession stores final plan | Browser Use's MessageHistory accumulates steps | Extend AgentSession to track step history; each step adds to history | **Extend** | Enable multi-step reasoning: step N+1 sees results of step N |
| **Loop control** | User approves once; executes once | Loop until done or blocked | NOT needed for hackathon; single-step approval sufficient | **Defer** | Can add iterative loops post-hackathon; focus on one good step first |

**Implementation Detail:**
```typescript
// NEW: agent loop (create src/services/agent-loop.ts)

export interface AgentStepInfo {
  stepNumber: number
  observation: SerializedPageState
  action: Action
  result: ActionExecutionResult
  resultContent?: string  // extracted_content
  stateAfter: SerializedPageState
  timestamp: number
}

export interface AgentLoopOptions {
  signal?: AbortSignal
  maxSteps?: number  // Default 1 for hackathon
}

export class AgentLoop {
  private observer: AgentObserver
  private executor: ActionExecutor
  private llmProvider: LLMProvider
  private history: AgentStepInfo[] = []
  
  async executeStep(prompt: string, userContext?: string): Promise<AgentStepInfo> {
    // 1. OBSERVE
    const stateBefore = await this.observer.observePageState()
    
    // 2. THINK (reuse existing PromptProcessor)
    const llmRequest = this.buildLLMRequest(prompt, stateBefore, userContext)
    const llmResponse = await this.llmProvider.chat(llmRequest)
    const plan = llmResponse.plan
    
    // 3. SAFETY VALIDATION (existing ActionSafetyValidator)
    const validation = validatePlanSafety(plan)
    if (!validation.allowed) throw new Error('Plan blocked by safety validator')
    
    // 4. ACT (existing ActionExecutor)
    const step = plan.steps[0]  // Execute only first step
    const exeResult = await this.executor.executeStep(step)
    
    // 5. RE-OBSERVE
    const stateAfter = await this.observer.observePageState()
    
    // 6. DIFF
    const diff = this.observer.computeDiff(stateBefore, stateAfter)
    
    // 7. BUILD STEP INFO
    const stepInfo: AgentStepInfo = {
      stepNumber: this.history.length + 1,
      observation: stateBefore,
      action: step.action,
      result: exeResult.result,
      resultContent: exeResult.extractedContent,
      stateAfter,
      timestamp: Date.now(),
    }
    
    this.history.push(stepInfo)
    return stepInfo
  }
  
  private buildLLMRequest(
    prompt: string,
    state: SerializedPageState,
    context?: string,
  ): LLMRequest {
    // Use existing PromptProcessor logic to build message
    // Include: prompt + state.domText + context + redaction summary
    // DO NOT include original values, only placeholders
    return {
      prompt,
      sanitizedContext: state.domText,
      // ... rest of LLMRequest fields
    }
  }
}
```

---

### 7. Privacy Pipeline: Redaction Mechanism (Sentinel's Core Strength)

**Current Sentinel**
```typescript
// src/services/sanitization.ts
export function sanitizeContext(
  dom: string,
  piiMatches: PIIMatch[],
  ...
): SanitizationOutput {
  // Build valueToPlaceholder map: "john@example.com" → "[EMAIL_001]"
  // Replace all PII values in DOM with placeholders
  // Return: {sanitizedDOM, valueToPlaceholder, ...}
}

// src/services/prompt-processor.ts: sanitizePrompt()
// Blocks prompt injections before LLM sees user prompt

// src/types/agent.ts: RedactionMapping
// Stores: original → placeholder mappings
```

**Browser Use Model**
```python
# Browser Use has no equivalent redaction system
# Assumes execution is local (untrusted LLM is ok as long as local execution)
```

**Recommended Sentinel Adaptation**

| Component | Current | Browser Use Concept | Sentinel Adaptation | Reuse/Extend/Replace | Reason |
|---|---|---|---|---|
| **Sanitization** | Replaces PII in DOM with placeholders | N/A (doesn't do this) | KEEP as-is; absolutely critical for privacy | **Reuse** | Sentinel's core innovation; never weaken |
| **Prompt injection blocking** | EXISTING: blocks XSS-like patterns | N/A | KEEP as-is | **Reuse** | Already comprehensive; works well |
| **Redaction mapping** | valueToPlaceholder: Map<string, string> | N/A | KEEP as-is; extend to include action results | **Extend** | When action returns extracted_content, also sanitize it before LLM sees it |
| **Action result sanitization** | None (actions don't return content yet) | N/A | NEW: when OTP action returns "456789", replace with "[OTP_001]" in LLM history | **Add** | Action extracted_content must also be redacted |
| **Approval UI** | Shows original values (user needs to see them) | N/A | KEEP showing original values to user in approval UI; LLM only sees placeholders | **Reuse** | User must verify action before approval; they see real values |

**Implementation Detail:**
```typescript
// Extend ExecutionRecord to include redaction
export interface ExecutionRecord {
  stepNumber: number
  action: Action
  validation: ActionValidationResult
  result: ActionExecutionResult
  // NEW:
  extractedContent?: string  // Original values visible to user in approval
  sanitizedExtractedContent?: string  // Placeholders only for LLM
  extractedContentRedactionMap?: RedactionMapping  // Maps original → placeholder
}

// Extend AgentLoop
export class AgentLoop {
  private redactionManager: RedactionManager
  
  async executeStep(...): Promise<AgentStepInfo> {
    // ... existing logic ...
    
    // After action execution:
    if (exeResult.extractedContent) {
      // Sanitize action result before LLM sees it
      const redacted = this.redactionManager.redactContent(
        exeResult.extractedContent,
        exeResult.result.actionId,
      )
      exeResult.sanitizedExtractedContent = redacted.sanitized
      exeResult.extractedContentRedactionMap = redacted.mapping
      
      // Update history message with SANITIZED content only
      // User approval UI shows ORIGINAL content
    }
    
    return stepInfo
  }
}
```

---

### 8. LLM Integration: Mock Provider → Real Provider (FUTURE)

**Current Sentinel**
```typescript
// src/services/llm-service.ts
export class MockLLMProvider implements LLMProvider {
  async chat(request: LLMRequest): Promise<LLMResponse> {
    // Returns hardcoded demo responses
    // Does not actually call any LLM
  }
}
```

**Browser Use Model**
```python
# browser_use/llm/ (12+ provider adapters)
# Supports: OpenAI, Anthropic, Google, Azure, Groq, Mistral, LiteLLM, etc.
# Each adapter handles: token counting, streaming, vision, tool calling
```

**Recommended Sentinel Adaptation**

| Component | Current | Browser Use Concept | Sentinel Adaptation | Reuse/Extend/Replace | Reason |
|---|---|---|---|---|
| **LLM Provider** | MockLLMProvider only | 12+ adapters | NOT for hackathon; mock is sufficient | **Defer** | No external LLM calls allowed in phase 9; use mock for demo |
| **Prompt formatting** | PromptProcessor.buildLLMRequest() | AgentMessagePrompt (comprehensive) | After agent loop implementation, port AgentMessagePrompt logic | **Adapt** | Browser Use's formatting is superior; port after core loop works |
| **Vision capability** | captureScreenshot() returns base64 | Included in CDP-based vision | Not needed for hackathon (LLM is mocked) | **Defer** | Real vision (sending screenshots to LLM) needs real LLM |
| **Tool calling** | Hardcoded action types | LLM selects from action_tools JSON schema | With real LLM: define tools as JSON schema, let LLM select | **Defer** | Mock provider returns hardcoded plan; skip for now |

---

## Architectural Conflicts & Resolutions

### Conflict 1: Element Targeting (Selector vs Index)

**Problem:** Sentinel uses CSS selectors in Actions; Browser Use uses numeric indexes.

**Why it matters:** Selectors are fragile (DOM changes break them). Indexes are regenerated per step.

**Resolution:**
- Extend `ActionTarget` with optional `index` field
- LLM uses index in prompts; ActionExecutor converts index→selector at execution time
- Selector map (`DOMSelectorMap`) stores bidirectional mapping

**Code change:** Minimal. One new field in ActionTarget.

---

### Conflict 2: Page State Representation (Full HTML vs Indexed)

**Problem:** Sentinel sends full outerHTML (~100KB) to scanner; Browser Use sends indexed interactive elements (~2KB) to LLM.

**Why it matters:** Token cost, LLM context window, stale references.

**Resolution:**
- KEEP full HTML for scanner (needed for comprehensive PII detection)
- ADD indexed serialization for LLM prompt (only interactive elements)
- Two parallel representations: ScanResult (full) + SerializedPageState (indexed)

**Code change:** Medium. Add SerializedPageState interface; add indexing service.

---

### Conflict 3: No Agent Loop Exists

**Problem:** Sentinel is single-pass (capture → scan → sanitize → LLM → execute). No re-observation, no step history.

**Why it matters:** Can't detect if action succeeded, can't react to page changes, can't propagate action results.

**Resolution:**
- Create new `AgentLoop` service
- Keep existing `PromptProcessor` for privacy pipeline
- AgentLoop calls PromptProcessor, then adds Observe-before/after logic

**Code change:** Large. New service + refactoring of PromptProcessor, but backward compatible.

---

### Conflict 4: No Real DOMBridge

**Problem:** Current `DOMBridge` is mocked; can't actually interact with web pages.

**Why it matters:** Can't test the full loop; agent is non-functional.

**Resolution:**
- Implement real DOMBridge in content-script
- Dispatch: click, fill, type, navigate, focus, scroll, send_keys
- Content-script handlers manipulate actual DOM elements

**Code change:** Medium. ~200 lines of content-script code + ~100 lines bridge adapter.

---

### Conflict 5: ActionSafetyValidator is Strict; Browser Use is Permissive

**Problem:** Sentinel blocks 150+ patterns; Browser Use allows most actions (run locally anyway).

**Why it matters:** Sentinel prioritizes privacy; Browser Use prioritizes capability.

**Resolution:**
- KEEP Sentinel's validator unchanged; it's correct
- Browser Use's heuristics are for untrusted remote LLM; local mock LLM is safe
- Never weaken the validator

**Code change:** None. Keep as-is.

---

### Conflict 6: No Iterative Loop (Single Step vs Multi-step)

**Problem:** Browser Use runs Observe-Think-Act loops until task done. Sentinel executes one plan then stops.

**Why it matters:** Complex tasks need multiple steps; approval UI can't handle auto-iteration.

**Resolution:**
- For hackathon: implement single-step execution only (user approves per step)
- AgentLoop architecture supports future iteration (just remove approval gate)
- Defer multi-step looping to post-hackathon

**Code change:** None needed. Design AgentLoop to support max_steps=1 (default).

---

### Conflict 7: Action Results Not Visible to LLM

**Problem:** Browser Use's `ActionResult.extracted_content` feeds into next step's LLM message. Sentinel has no such mechanism.

**Why it matters:** Critical for OTP retrieval: action returns code, LLM sees code in next step, fills it in.

**Resolution:**
- Extend `ExecutionRecord` with `extractedContent` field
- Add to LLM history message as "Action result: [OTP_001]" (sanitized)
- Enable action→result→LLM pipeline

**Code change:** Medium. Extend ExecutionRecord + update message formatting.

---

## Implementation Sequence

**Goal:** Implement browser automation core (DOMBridge + AgentLoop) without replacing privacy pipeline.

### Phase 1: Foundation (Week 1)

**1.1 Extend Type System**
- Add to `src/types/agent.ts`:
  - `IndexedDOMElement` interface
  - `DOMSelectorMap` type
  - `SerializedPageState` interface
  - `ActionType`: add 'scroll', 'send_keys'
  - Extend `ActionTarget` with `index?: number`
  - Extend `ExecutionRecord` with `extractedContent`, `stateAfter`, etc.

**Files to modify:** `src/types/agent.ts` (add ~100 lines)

**1.2 Create AgentObserver Service**
- File: `src/services/agent-observer.ts`
- Responsibility: capture page → index interactive elements → serialize for LLM
- Methods:
  - `observePageState(): Promise<SerializedPageState>`
  - `computeDiff(before, after): PageStateDiff`
  - Private: `indexInteractiveElements(dom): DOMSelectorMap`
  - Private: `serializeToLLMFormat(selectorMap): string` (returns `[3]<button>...` format)

**Size:** ~300 lines

**Dependencies:** 
- Uses existing `captureActiveTab()`, `captureScreenshot()`
- Uses `ClickableElementDetector.is_interactive()` (already copied in reference)
- Needs helper to convert DOM Elements to IndexedDOMElement

**1.3 Build Real DOMBridge in Content-Script**
- File: `extension/content-script.js` (extend existing)
- Implement handlers:
  - `EXTRACT_INTERACTIVE_DOM`: run indexing, return `DOMSelectorMap`
  - `CLICK`: dispatch click event on element matching selector
  - `FILL`: set input value + dispatch change event
  - `TYPE`: focus, clear, type text
  - `NAVIGATE`: set `window.location.href`
  - `FOCUS`: call element.focus()
  - `SCROLL`: scroll window or container by amount
  - `SEND_KEYS`: dispatch keyboard events (Enter, Escape, etc.)

**Size:** ~200 lines (well-structured handlers)

**Dependencies:** 
- Must handle CSS selector to Element lookup
- Must handle cross-origin iframes gracefully (skip or error cleanly)

**1.4 Extend Extension Bridge**
- File: `src/services/extension-bridge.ts` (extend existing)
- Add functions:
  - `extractInteractiveDOM(): Promise<SerializedPageState>`
  - `dispatchClickAction(selector: string): Promise<DOMOperationResult>`
  - `dispatchFillAction(selector: string, value: string): Promise<DOMOperationResult>`
  - etc. (map to new content-script handlers)

**Size:** ~150 lines

---

### Phase 2: Agent Loop Integration (Week 2)

**2.1 Create AgentLoop Service**
- File: `src/services/agent-loop.ts`
- Core method: `async executeStep(prompt: string, userContext?: string): Promise<AgentStepInfo>`
- Orchestration:
  1. Observe page state (AgentObserver)
  2. Build LLM request with sanitized state
  3. Get LLM response (mock provider)
  4. Validate plan (ActionSafetyValidator)
  5. Execute first step (ActionExecutor)
  6. Re-observe page state
  7. Compute diff
  8. Sanitize extracted content if present
  9. Return step info

**Size:** ~250 lines

**Dependencies:**
- `AgentObserver`
- Existing `PromptProcessor.buildLLMRequest()` logic
- Existing `ActionSafetyValidator`
- Existing `ActionExecutor`
- New real `DOMBridge`

**2.2 Update ActionExecutor for Real Bridge**
- File: `src/services/action-executor.ts` (modify existing)
- Change: replace `MockDOMBridge` with real implementation
- Change: add real browser interaction (currently all methods return success)
- Minimal modification: swap bridge implementation, no logic changes

**Size:** ~30 lines (mostly in tests)

**2.3 Extend PromptProcessor for Multi-step History**
- File: `src/services/prompt-processor.ts` (extend existing)
- Add: ability to retain step history across calls
- Add: method to build LLM message including prior steps
- Change: leverage new `AgentLoop` for core step execution

**Size:** ~80 lines

---

### Phase 3: Privacy + Execution Integration (Week 3)

**3.1 Extend Sanitization for Action Results**
- File: `src/services/sanitization.ts` (extend existing)
- Add: method to redact extracted_content from actions
- Change: ensure action results are treated like DOM content (redact PII)

**Size:** ~50 lines

**3.2 Wire ApprovalUI for Action Results**
- File: `src/pages/ApprovalPage.tsx` (modify existing)
- Display: original action result (unredacted) for user review
- Send to LLM: sanitized version (redacted)

**Size:** ~40 lines (display logic)

**3.3 Test Suite**
- Add integration tests:
  - Test AgentObserver.observePageState() (mock page)
  - Test DOMBridge.click() via content-script (integration test)
  - Test AgentLoop.executeStep() end-to-end
  - Test diff computation
  - Test redaction of extracted content

**Size:** ~400 lines

---

### Phase 4: Approval UI + Browser Integration (Week 4)

**4.1 Extend Approval UI**
- File: `src/pages/ApprovalPage.tsx`
- Display:
  - Current page state (screenshot with element indexes overlaid)
  - Planned action
  - Action result (if action returned extracted_content)
  - State diff (new elements appeared, etc.)

**Size:** ~100 lines

**4.2 Create Floating Widget (Optional for Hackathon)**
- File: `src/components/AgentWidget.tsx`
- Display: on live website (injected via content-script shadow DOM)
- Shows: current agent phase, pending action, approve/deny buttons
- Minimal style to avoid conflicts

**Size:** ~150 lines (if included; can defer)

**4.3 Launch Agent Loop from UI**
- File: `src/pages/Dashboard.tsx` or new `AgentPage.tsx`
- Add: "Start Agent" button
- Calls: `AgentLoop.executeStep(userPrompt)`
- Displays: step results in real-time

**Size:** ~100 lines

---

## Exact Implementation Order (Do-This-First)

### Must-Have (Hackathon Minimum)

1. **Extend types** (`src/types/agent.ts`) — 30 minutes
   - Add `IndexedDOMElement`, `SerializedPageState`, `DOMSelectorMap`
   - Extend `ActionTarget` with `index`
   - Extend `ExecutionRecord` with `stateAfter`, `extractedContent`

2. **Build AgentObserver** (`src/services/agent-observer.ts`) — 3 hours
   - Port `ClickableElementDetector.is_interactive()` from Browser Use reference
   - Implement indexing + serialization to `[N]<tag>` format
   - Implement diff computation

3. **Implement real DOMBridge** (`extension/content-script.js` + `src/services/extension-bridge.ts`) — 3 hours
   - Content-script handlers for click, fill, type, focus, navigate, scroll, send_keys
   - Extension bridge functions mapping to content-script messages
   - Error handling for cross-origin, missing elements, etc.

4. **Create AgentLoop** (`src/services/agent-loop.ts`) — 4 hours
   - Orchestrate: observe → think → act → re-observe
   - Integrate: AgentObserver + ActionExecutor + PromptProcessor + safety validator
   - Handle: state diff, redaction, step history

5. **Update ActionExecutor** (`src/services/action-executor.ts`) — 1 hour
   - Use real DOMBridge instead of mock
   - Test with real actions

6. **Test end-to-end** (`src/services/__tests__/agent-loop.test.ts`) — 4 hours
   - Mock page HTML
   - Test indexing produces stable numbers
   - Test state diff after action
   - Test redaction of extracted content
   - Test 340 existing tests still pass

### Nice-to-Have (If Time)

7. **Extend Approval UI** — 2 hours
   - Show element indexes overlaid on screenshot
   - Display state diff

8. **Floating Widget** (defer post-hackathon) — 4 hours

---

## Testing Strategy

### Unit Tests (Keep 340 Existing Tests Green)

- Existing test suites must pass:
  - `src/services/__tests__/scanner.test.ts` (PII detection)
  - `src/services/__tests__/injection-detector.test.ts` (prompt injection)
  - `src/services/__tests__/action-executor.test.ts` (execution flow)
  - etc.

### Integration Tests (New)

**Test 1: AgentObserver**
```typescript
// Mock page with 5 interactive elements
const html = `<button id="btn1">Click me</button><input id="inp1" /><div>Text</div>`

const state = await observer.observePageState()
// Assert: state.selectorMap has 2 entries (#btn1, #inp1)
// Assert: state.selectorMap[1].selector === '#btn1'
// Assert: state.domText contains '[1]<button>Click me</button>'
```

**Test 2: DOMBridge**
```typescript
// Inject test iframe with live DOM
const bridge = new RealDOMBridge()

// Click
await bridge.click('#button')
// Assert: button click was dispatched

// Fill
await bridge.fill('#email', 'test@example.com')
// Assert: input.value === 'test@example.com'
```

**Test 3: AgentLoop**
```typescript
// Mock page + mock LLM response
const loop = new AgentLoop()
const step = await loop.executeStep("Click the button")

// Assert: step.observation.selectorMap exists
// Assert: step.action.type === 'click'
// Assert: step.result.status === 'completed'
// Assert: step.stateAfter.domText !== step.observation.domText (if page changed)
```

---

## Success Criteria

**At end of Phase 2 (Agent Loop complete):**

✅ Can observe page → extract interactive elements with numeric indexes  
✅ Can serialize page state in `[N]<tag>` format suitable for LLM  
✅ Can execute click/fill/type/navigate actions via real DOMBridge  
✅ Can re-observe after action and detect changes  
✅ All existing 340 tests pass  
✅ New integration tests demonstrate full loop working  
✅ Approval UI shows indexed elements on screenshot  

**At end of Phase 3 (Privacy integration complete):**

✅ Action extracted_content is redacted before LLM sees it  
✅ User approval shows original values; LLM sees placeholders only  
✅ RedactionMapping tracks all PII+action results  

**At end of Phase 4 (Polish):**

✅ Agent can handle multi-element pages (20+, 100+)  
✅ Element indexes stable across reloads  
✅ State diff correctly identifies appeared/disappeared elements  
✅ OTP retrieval action works: action returns "Code: 456789", LLM sees "[OTP_001]"  

---

## Files to Create/Modify Summary

### Create (New Files)
- `src/services/agent-observer.ts` (300 LOC)
- `src/services/agent-loop.ts` (250 LOC)
- `src/services/__tests__/agent-observer.test.ts` (200 LOC)
- `src/services/__tests__/agent-loop.test.ts` (250 LOC)

### Modify (Existing Files)
- `src/types/agent.ts` (+100 LOC)
- `src/services/extension-bridge.ts` (+150 LOC)
- `src/services/action-executor.ts` (±30 LOC)
- `src/services/prompt-processor.ts` (+80 LOC)
- `src/services/sanitization.ts` (+50 LOC)
- `extension/content-script.js` (+200 LOC)
- `src/pages/ApprovalPage.tsx` (+50 LOC)

### Total New Code: ~1,360 LOC
### Total Modified Code: ~660 LOC (mostly extensions, minimal breaking changes)

---

## Browser Use Concepts NOT to Port

1. **CDP WebSocket management** — Extension uses chrome.tabs/scripting APIs, not CDP
2. **Playwright integration** — Not applicable; extension is browser-native
3. **Cloud sync / telemetry** — Sentinel is local-only
4. **LLM provider adapters** — Mock provider sufficient for hackathon; port when real LLM needed
5. **Skills registry** — Sentinel doesn't have a skills system; individual actions are hardcoded
6. **Watchdogs** (CAPTCHA, crash, download, etc.) — Extension handles these natively
7. **Multi-tab coordination** — Hackathon focuses on single active tab
8. **Streaming responses** — Mock provider doesn't stream; add when real LLM ready
9. **File system operations** — Browser extension has no filesystem access
10. **Markdown extraction** — Sentinel sends indexed elements; doesn't need markdown

---

## Conclusion

Sentinel's privacy pipeline (scan, sanitize, redaction) is complete and correct. Browser Use's agent loop + element indexing fills the missing orchestration layer. The two architectures are **complementary, not competitive**.

**Adaptation is straightforward:**
- Add numeric indexing + state serialization (AgentObserver)
- Build real DOMBridge using DOM APIs (extension content-script)
- Orchestrate Observe-Think-Act-Re-observe (AgentLoop)
- Extend privacy pipeline to redact action results
- Keep ActionSafetyValidator as strict final authority

**No existing Sentinel services need replacement.** Only extensions and orchestration.

**Estimated effort:** 3-4 weeks for solo developer to reach "working agent loop" stage. Hackathon timeline permits cutting Phases 3-4 and running with single-step execution + approval UI only.

