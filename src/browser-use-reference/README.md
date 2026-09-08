# Browser Use — Reference Extraction for Sentinel Lens

Source: https://github.com/browser-use/browser-use (MIT License, Copyright 2024 Gregor Zunic)
Extracted: 2026-09-08 for Sentinel Lens hackathon agent implementation.

These files are READ-ONLY reference. Do not modify existing Sentinel services.

---

## Classification Table

| Browser Use File | Relevant Functionality | Sentinel Equivalent | Class | Reason |
|---|---|---|---|---|
| `agent/service.py` | Agent loop: step(), observe→think→act→re-observe, history management | `src/services/agent-loop.ts` (TO BUILD) | B | Core loop logic — adapt to TypeScript async/await; replace Playwright with content-script bridge |
| `agent/views.py` | AgentState, AgentOutput, ActionResult, StepMetadata, PlanItem data structures | `src/types/agent.ts` (extend) | B | Port Pydantic models to TypeScript interfaces; AgentState maps directly |
| `agent/prompts.py` | AgentMessagePrompt: formats browser_state + screenshot + history into LLM messages | `src/services/prompt-processor.ts` (extend) | B | Core prompt-building logic; adapt to Sentinel's sanitized context format |
| `agent/system_prompts/system_prompt.md` | Full LLM system prompt: role, input format, browser rules, action rules | New `src/assets/system-prompt.md` | C | Use as template for Sentinel's privacy-aware system prompt; add redaction rules |
| `agent/message_manager_views.py` | MessageHistory, HistoryItem — conversation state across steps | Extend `src/types/agent.ts` | C | Understand message threading; adapt for Sentinel's step history |
| `dom/views.py` | DOMRect, SerializedDOMState, DOMSelectorMap, DEFAULT_INCLUDE_ATTRIBUTES, EnhancedAXNode | `src/types/dom.ts` (TO BUILD) | B | Port data structures; DEFAULT_INCLUDE_ATTRIBUTES list is directly usable for content-script extraction |
| `dom/serializer/clickable_elements.py` | ClickableElementDetector.is_interactive() — 150+ line heuristic for detecting interactive elements | `src/services/dom-bridge.ts` (TO BUILD) | B | Port is_interactive() to TypeScript for content-script use; replaces CDP with DOM APIs |
| `dom/serializer/serializer.py` | DOMTreeSerializer: DOM tree → indexed `[N]<tag attr=val>` string for LLM | `src/services/dom-serializer.ts` (TO BUILD) | C | Reference for LLM-readable serialization format; adapt for extension content-script output |
| `dom/enhanced_snapshot.py` | CDP snapshot parsing: visibility, cursor, bounding boxes, computed styles | `src/services/dom-bridge.ts` | C | Concepts only — extension uses `getBoundingClientRect()` + `getComputedStyle()` not CDP |
| `dom/markdown_extractor.py` | DOM → clean Markdown extraction for LLM context | N/A (DOM is already sanitized) | C | Pattern reference for content extraction; Sentinel already sanitizes DOM text |
| `tools/views.py` | ClickElementAction, InputTextAction, NavigateAction, ScrollAction, SendKeysAction | `src/types/agent.ts` Action union | B | Map to Sentinel's existing Action types; add ScrollAction, SendKeysAction |
| `browser/views.py` | BrowserStateSummary, TabInfo, PageInfo, NetworkRequest, BrowserStateHistory | `src/types/dom.ts` (TO BUILD) | B | BrowserStateSummary is the structured page state Sentinel's agent loop needs |
| `integrations/gmail_actions.py` | get_recent_emails action: reads Gmail for OTP/2FA codes within time window | `src/services/gmail-bridge.ts` (TO BUILD) | C | Architecture reference: action wraps a service, returns ActionResult with extracted_content |
| `actor/element.py` | Element-level interaction: click, fill, hover via Playwright CDP | `extension/content-script.js` DOM actions | C | Concepts only — extension uses DOM events not Playwright; port click/fill/type logic |
| `actor/page.py` | Page-level: scroll, navigate, wait, screenshot via Playwright | `src/services/action-executor.ts` (extend) | C | Scroll/navigate/wait patterns; replace Playwright with chrome.tabs + content-script messages |

---

## Files NOT Copied and Why

| Path | Reason Excluded |
|---|---|
| `browser_use/browser/session.py` + `chrome.py` + watchdogs | Playwright/CDP session management — extension already controls the browser via chrome APIs |
| `browser_use/llm/` (entire dir) | Python LLM adapters — Sentinel uses extension-bridge to call Claude via chrome.runtime; 12 provider adapters all irrelevant |
| `browser_use/dom/service.py` | Orchestrates CDP calls — extension content-script replaces entire DomService |
| `browser_use/integrations/gmail/service.py` | Python google-auth OAuth2 — completely non-portable; extension uses chrome.identity or direct fetch |
| `browser_use/telemetry/`, `browser_use/sync/`, `browser_use/mcp/` | Cloud sync, telemetry, MCP server — none needed for local extension |
| `browser_use/filesystem/` | File system state — browser extension has no filesystem; irrelevant |
| `browser_use/skills/`, `browser_use/tokens/` | Skills registry, token counting — Python-specific infrastructure |
| `browser_use/sandbox/` | Docker sandbox — extension runs natively |
| `browser_use/cli.py`, `__main__.py`, `init_cmd.py` | CLI tools — extension has its own UI |
| `examples/` (all 80+ files) | Architecture already understood; examples reference Python runtime |
| `tests/` | Python test suite — Sentinel has its own Vitest suite |
| `browser_use/agent/gif.py`, `judge.py`, `cloud_events.py` | GIF export, judge evaluation, cloud events — not needed for local extension |
| `browser_use/browser/watchdogs/` (all 12 files) | CAPTCHA, crash, download, permissions watchdogs — Playwright-specific |
| `browser_use/dom/serializer/paint_order.py`, `eval_serializer.py`, `html_serializer.py` | Paint-order filtering, eval serializer — optimization passes not needed at hackathon stage |
| `browser_use/agent/system_prompts/` (6 variants, kept 1) | Flash/Anthropic/no-thinking variants — copied only base `system_prompt.md` |

---

## TypeScript Adaptations Required (Class B files)

### 1. `agent/service.py` → `src/services/agent-loop.ts`
- Replace `async def step()` with `async step(): Promise<AgentStep>`
- Replace `BrowserSession.get_state()` with `captureActiveTab()` + `captureScreenshot()`
- Replace `MessageManager` with in-memory array of `LLMMessage[]`
- Replace LLM call with `chrome.runtime.sendMessage({type:'LLM_REQUEST', ...})`
- Replace `ActionResult` handling with Sentinel's `AgentPhase` state machine

### 2. `agent/views.py` → extend `src/types/agent.ts`
- Port `AgentState`, `PlanItem`, `StepMetadata` as TypeScript interfaces
- `ActionResult` → already partially in `src/types/agent.ts`; add `extracted_content`, `long_term_memory`

### 3. `dom/serializer/clickable_elements.py` → `src/services/dom-bridge.ts`
- Port `is_interactive(node)` to operate on `Element` (browser DOM) not `EnhancedDOMTreeNode`
- Replace `node.has_js_click_listener` with `getEventListeners()` polyfill or heuristic
- Replace `node.ax_node` with `element.getAttribute('role')`
- Use `window.getComputedStyle(el).cursor === 'pointer'` instead of `snapshot_node.cursor_style`

### 4. `dom/views.py` → `src/types/dom.ts`
- Port `SerializedDOMState` (url, title, dom_text, selector_map) as TS interface
- Port `DEFAULT_INCLUDE_ATTRIBUTES` list as `const INCLUDE_ATTRIBUTES: string[]`
- Port `DOMSelectorMap` as `Record<number, DOMElement>`

### 5. `tools/views.py` → extend `src/types/agent.ts`
- Add `ScrollAction`, `SendKeysAction`, `DoneAction` to existing Action union type
- `ClickElementAction` with `index` → maps to existing `click` Action with `target.selector`

### 6. `browser/views.py` → `src/types/dom.ts`
- Port `BrowserStateSummary` as TS interface: `{url, title, domText, screenshot, interactiveElements}`
- `TabInfo` → `{url, title, tabId}`
- `PageInfo` → `{viewportWidth, viewportHeight, scrollY, pixelsBelow}`

---

## Browser Use Concepts Sentinel Should Adopt

1. **Numbered interactive element index** — `[1]<button>Submit</button>` — LLM references elements by number, not CSS selector. Eliminates brittle selectors in LLM output.

2. **Agent step memory** — Each step has `evaluation_previous_goal`, `memory`, `next_goal`. Sentinel's AgentPhase state machine should carry forward step memory.

3. **ActionResult.extracted_content** — Actions can return text the LLM sees in the next step. Critical for OTP retrieval: Gmail action returns `extracted_content="Code is 123456"`.

4. **Scrollable element detection** — `is_actually_scrollable` from computed styles. Sentinel's content script should mark scrollable containers.

5. **DEFAULT_INCLUDE_ATTRIBUTES** — The 30+ attribute list that Browser Use extracts per element (title, type, placeholder, aria-label, role, value, etc.) is directly usable in Sentinel's DOM extraction.

6. **System prompt structure** — The `<user_request>`, `<agent_history>`, `<browser_state>`, `<browser_vision>`, `<browser_rules>` sections. Sentinel should use this same structure, with an added `<privacy_context>` section for the redaction map.

7. **Sensitive data redaction in prompts** — Browser Use uses `sensitive_data` parameter to redact values before LLM. Sentinel already does this via `valueToPlaceholder` — confirm the integration point in `AgentMessagePrompt`.

---

## Conflicts with Existing Sentinel Architecture

| Conflict | Browser Use Approach | Sentinel Approach | Resolution |
|---|---|---|---|
| Browser control | Playwright CDP over WebSocket | Chrome Extension content-script messaging | Keep Sentinel's approach; replace all Playwright calls with `chrome.runtime.sendMessage` |
| LLM integration | Multiple provider adapters (OpenAI, Anthropic, etc.) | NO external LLM (hackathon constraint) | Must use local mock or future claude-in-extension; skip all LLM adapter code |
| DOM access | CDP DOMSnapshot + Accessibility tree | content-script `document.querySelectorAll()` + `getBoundingClientRect()` | Port clickable detection heuristics to DOM API equivalents |
| Element targeting | Numeric index from serialized DOM | CSS selector in Action.target.selector | Adopt numeric index approach in new DOM bridge; map index → selector for execution |
| OTP/Gmail | Python google-auth OAuth2 flow | Extension cannot run OAuth server flow | Use `chrome.identity` for OAuth or user-provided token; action returns code as extracted_content |
| Action safety | No built-in safety validator | Sentinel has 150+ pattern `ActionSafetyValidator` | Keep Sentinel's validator; Browser Use is permissive by design |

---

## License / Attribution

MIT License — Copyright (c) 2024 Gregor Zunic  
Full text in `LICENSE`.  
Attribution required when distributing. For the Sentinel Lens extension:
- Add to extension README: "Agent loop concepts adapted from Browser Use (MIT) by Gregor Zunic"
- No attribution needed in UI for internal/hackathon use

---

## Exact Next Implementation Step

After this extraction phase, implement in this order:

### Step 1 — Real DOMBridge (content-script DOM extraction)
File: `src/services/dom-bridge.ts`
- Port `clickable_elements.py:is_interactive()` to TypeScript operating on `Element`
- Extract `[N]<tag attr>text` serialization using `DEFAULT_INCLUDE_ATTRIBUTES`
- Wire to `extension/content-script.js` via `chrome.runtime.sendMessage({type:'EXTRACT_INTERACTIVE_DOM'})`
- Return `SerializedDOMState` with `domText` (LLM-readable) and `selectorMap` (index→Element)

### Step 2 — Agent Loop Core
File: `src/services/agent-loop.ts`
- Implement `AgentLoop` class with `step()` method
- Observe: call `captureActiveTab()` + `captureScreenshot()` → `BrowserStateSummary`
- Think: call `sanitizePrompt()` → placeholder-only context → send to LLM (mock first)
- Act: parse LLM output → `Action[]` → validate via `ActionSafetyValidator` → show approval UI
- Re-observe: repeat from Observe with updated `AgentPhase`

### Step 3 — Approval UI integration
- `AgentPhase.awaiting-approval` shows diff: planned actions vs current page
- User approves → `ActionExecutor.execute()` via real DOM bridge
- User denies → `AgentPhase.cancelled`

### Step 4 — Floating widget
- React Portal injected into active tab via content-script
- Shows current `AgentPhase`, pending action, approve/deny buttons
- Minimal DOM footprint (shadow DOM to avoid style conflicts)
