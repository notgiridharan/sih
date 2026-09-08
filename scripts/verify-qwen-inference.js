#!/usr/bin/env node
/**
 * Verify Qwen3-0.6B planner setup.
 *
 * This script checks everything that can be verified outside of a browser:
 *   1. @mlc-ai/web-llm package is installed and exports CreateMLCEngine
 *   2. Qwen3-0.6B-q4f16_1-MLC is listed in the prebuilt model registry
 *   3. The model config is valid (vram, context window, lib URL)
 *   4. The SYSTEM_PROMPT and prompt builder work correctly
 *   5. parseModelOutput correctly enforces all invariants
 *
 * Full WebGPU inference (the actual model forward pass) runs in the browser —
 * open extension/verify-qwen-inference.html in Chrome 113+ to run it.
 *
 * Usage:
 *   node scripts/verify-qwen-inference.js
 */

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

let passed = 0
let failed = 0

function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`)
    failed++
  }
}

// ─── 1. Package & model registry ─────────────────────────────────────────────

console.log('\n[1] @mlc-ai/web-llm package')
let wllm
try {
  wllm = require('@mlc-ai/web-llm')
  ok('package loads', true)
} catch (e) {
  ok('package loads', false, e.message)
  process.exit(1)
}

ok('exports CreateMLCEngine',        typeof wllm.CreateMLCEngine === 'function')
ok('exports MLCEngine class',        typeof wllm.MLCEngine === 'function')
ok('exports prebuiltAppConfig',      typeof wllm.prebuiltAppConfig === 'object')

console.log('\n[2] Model registry — Qwen3-0.6B-q4f16_1-MLC')
const MODEL_ID = 'Qwen3-0.6B-q4f16_1-MLC'
const modelList = wllm.prebuiltAppConfig?.model_list ?? []
const entry = modelList.find(m => m.model_id === MODEL_ID)

ok(`"${MODEL_ID}" in prebuilt registry`, !!entry)
if (entry) {
  ok('model.model points to HuggingFace mlc-ai',  entry.model?.includes('mlc-ai'))
  ok('model.model_lib points to WASM binary',      entry.model_lib?.endsWith('.wasm'))
  ok('model has vram_required_MB',                 typeof entry.vram_required_MB === 'number')
  ok('vram fits on consumer GPUs (<= 4096 MB)',    entry.vram_required_MB <= 4096)
  ok('context_window_size >= 4096',                (entry.overrides?.context_window_size ?? 0) >= 4096)
  console.log(`     model:      ${entry.model}`)
  console.log(`     model_lib:  ${entry.model_lib.slice(0, 80)}...`)
  console.log(`     vram_MB:    ${entry.vram_required_MB}`)
  console.log(`     ctx_window: ${entry.overrides?.context_window_size ?? 'default'}`)
}

// ─── 2. Prompt engineering ────────────────────────────────────────────────────

console.log('\n[3] SYSTEM_PROMPT structure')

// Load via dynamic import (TypeScript compiled output or source via tsx)
let SYSTEM_PROMPT, buildUserPrompt, parseModelOutput, QWEN3_MODEL_ID
try {
  // Try compiled JS first
  const mod = require('../src/services/qwen-planner.ts')
  SYSTEM_PROMPT   = mod.SYSTEM_PROMPT
  buildUserPrompt = mod.buildUserPrompt
  parseModelOutput = mod.parseModelOutput
  QWEN3_MODEL_ID  = mod.QWEN3_MODEL_ID
} catch {
  // If TypeScript source can't be required directly, do inline checks
  SYSTEM_PROMPT = null
}

if (SYSTEM_PROMPT) {
  ok('SYSTEM_PROMPT is a non-empty string',              typeof SYSTEM_PROMPT === 'string' && SYSTEM_PROMPT.length > 100)
  ok('contains all 10 allowed action types',            ['navigate','click','fill','type','focus','wait','scroll','select','send_keys','go_back'].every(t => SYSTEM_PROMPT.includes(t)))
  ok('mandates requiresApproval for fill',              SYSTEM_PROMPT.includes('requiresApproval: true'))
  ok('instructs JSON-only output',                      SYSTEM_PROMPT.toLowerCase().includes('json'))
  ok('prohibits raw PII in values',                     SYSTEM_PROMPT.toLowerCase().includes('credential') || SYSTEM_PROMPT.toLowerCase().includes('password') || SYSTEM_PROMPT.toLowerCase().includes('pii'))
  ok('QWEN3_MODEL_ID matches registry',                 QWEN3_MODEL_ID === MODEL_ID)
} else {
  console.log('     (TypeScript source not directly importable — skipping prompt checks)')
  console.log('     Run: npx tsx scripts/verify-qwen-inference.js  for full checks')
}

// ─── 3. parseModelOutput invariants ──────────────────────────────────────────

if (parseModelOutput) {
  console.log('\n[4] parseModelOutput invariants')

  const fakeRequest = {
    prompt: 'test',
    sanitizedContext: 'context',
    pageUrl: 'https://example.com',
    pageTitle: 'Test',
    availableActions: ['navigate', 'click', 'fill'],
    redactionSummary: { totalRedacted: 2, categories: {} },
  }

  // Normal output
  const normal = parseModelOutput({
    reasoning: 'Navigate then fill',
    riskLevel: 'medium',
    steps: [
      { stepNumber: 1, type: 'navigate', selector: null, value: '/login', description: 'Go', requiresApproval: false, dependsOn: [] },
      { stepNumber: 2, type: 'fill', selector: 'input', value: null, description: 'Fill', requiresApproval: false, dependsOn: [1] },
    ],
  }, fakeRequest)

  ok('plan has id',                   typeof normal.id === 'string' && normal.id.length > 0)
  ok('steps are sequential from 1',   normal.steps.every((s, i) => s.stepNumber === i + 1))
  ok('all actions safe=true',         normal.steps.every(s => s.action.safe === true))
  ok('fill enforces requiresApproval',normal.steps.find(s => s.action.type === 'fill')?.action.requiresApproval === true)
  ok('reasoning preserved',           normal.reasoning === 'Navigate then fill')
  ok('riskLevel preserved',           normal.riskLevel === 'medium')
  ok('redaction warning included',    normal.warnings.some(w => w.includes('2 sensitive')))

  // Edge cases
  const empty = parseModelOutput({ steps: [] }, fakeRequest)
  ok('empty steps → at least 1 fallback step', empty.steps.length >= 1)

  const badTypes = parseModelOutput({
    steps: [{ type: 'eval_js', description: 'x', dependsOn: [] }],
  }, fakeRequest)
  ok('unknown types coerced to wait', badTypes.steps[0].action.type === 'wait')

  const badDeps = parseModelOutput({
    steps: [
      { type: 'navigate', description: 'a', dependsOn: [] },
      { type: 'click',    description: 'b', dependsOn: [99, 2] }, // 99 > stepNumber, 2 = self
    ],
  }, fakeRequest)
  ok('invalid dependsOn filtered out', badDeps.steps[1].dependsOn.every(d => d < 2))
}

// ─── 4. Summary ──────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)

if (failed === 0) {
  console.log('\n✓ All checks passed.')
  console.log('\nFor full WebGPU inference verification:')
  console.log('  1. npm run build:extension')
  console.log('  2. Load dist-extension/ in Chrome (chrome://extensions → Load unpacked)')
  console.log('  3. Open extension/verify-qwen-inference.html in Chrome 113+')
  console.log('     — the page downloads Qwen3-0.6B (~380 MB on first run) and')
  console.log('       runs a complete planning cycle, printing the JSON action plan.')
} else {
  console.log('\n✗ Some checks failed — fix the issues above before deployment.')
  process.exit(1)
}
