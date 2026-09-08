/**
 * GLiNER-small local NER inference for PII detection.
 *
 * Requires two files bundled in the extension's `assets/models/` directory:
 *   - gliner-small.onnx   (GLiNER-small v1 ONNX export, ~40 MB int8 quantized)
 *   - gliner-vocab.txt    (BERT WordPiece vocabulary, one token per line)
 *
 * When those files are absent the service returns an empty array and the
 * caller falls back to the existing regex detector.
 *
 * All inference runs locally in the browser via ONNX Runtime Web (WASM
 * execution provider).  No data leaves the device.
 */

import * as ort from 'onnxruntime-web'
import type { PIIMatch, PIICategory, RiskLevel } from '../types/scan'
import { GLiNERTokenizer } from './gliner-tokenizer'

// ---------------------------------------------------------------------------
// Entity-label → PII category mapping
// ---------------------------------------------------------------------------

interface EntitySpec {
  label: string
  category: PIICategory
  risk: RiskLevel
  action: string
}

const ENTITY_SPECS: EntitySpec[] = [
  { label: 'person name', category: 'name', risk: 'medium', action: 'Consider redacting personal name' },
  { label: 'email address', category: 'email', risk: 'high', action: 'Redact before sharing' },
  { label: 'phone number', category: 'phone', risk: 'high', action: 'Redact or mask digits' },
  { label: 'physical address', category: 'address', risk: 'medium', action: 'Consider redacting physical location' },
  { label: 'social security number', category: 'ssn', risk: 'critical', action: 'Block — do not transmit to AI agent' },
  { label: 'credit card number', category: 'credit_card', risk: 'critical', action: 'Block — do not transmit to AI agent' },
  { label: 'bank account number', category: 'bank_account', risk: 'critical', action: 'Block — banking information must not be shared' },
  { label: 'date of birth', category: 'date_of_birth', risk: 'high', action: 'Redact — personal identifier' },
  { label: 'api key or token', category: 'api_key', risk: 'critical', action: 'Block — credential must not be exposed' },
  { label: 'PAN card number', category: 'pan', risk: 'critical', action: 'Block — government ID must not be shared' },
  { label: 'aadhaar number', category: 'aadhaar', risk: 'critical', action: 'Block — government ID must not be shared' },
  { label: 'UPI payment ID', category: 'upi_id', risk: 'high', action: 'Redact before sharing' },
]

const ENTITY_LABELS = ENTITY_SPECS.map((s) => s.label)

// ---------------------------------------------------------------------------
// Redaction helper (mirrors the one in pii-detector.ts)
// ---------------------------------------------------------------------------

function redact(value: string, type: PIICategory): string {
  const len = value.length
  switch (type) {
    case 'email': {
      const at = value.indexOf('@')
      if (at < 1) return `${'*'.repeat(len)}`
      return `${value[0]}${'*'.repeat(at - 1)}@${value.slice(at + 1)}`
    }
    case 'phone': return value.replace(/\d(?=\d{4})/g, '*')
    case 'ssn': return `***-**-${value.slice(-4)}`
    case 'credit_card': return `**** **** **** ${value.replace(/\D/g, '').slice(-4)}`
    case 'pan': return `${'*'.repeat(5)}${value.slice(5, 9)}*`
    case 'aadhaar': return `**** **** ${value.replace(/\D/g, '').slice(-4)}`
    case 'upi_id': return `${'*'.repeat(4)}@***`
    case 'bank_account': return `${'*'.repeat(Math.max(len - 4, 3))}${value.slice(-4)}`
    case 'date_of_birth': return '**/**/****'
    case 'api_key': return `${value.slice(0, 4)}${'*'.repeat(Math.max(len - 8, 4))}${value.slice(-4)}`
    case 'name': return `${value[0]}${'*'.repeat(Math.max(len - 1, 2))}`
    case 'address': return '[REDACTED ADDRESS]'
    default: return '*'.repeat(Math.min(len, 8))
  }
}

// ---------------------------------------------------------------------------
// ONNX Runtime configuration
// ---------------------------------------------------------------------------

const MAX_SPAN_LENGTH = 12  // max words per candidate span
const CONFIDENCE_THRESHOLD = 0.5
const MAX_TEXT_LENGTH = 512  // token budget for the full sequence

function resolveAssetUrl(path: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    return chrome.runtime.getURL(path)
  }
  return `/${path}`
}

// ---------------------------------------------------------------------------
// Session singleton — loaded once, reused for every scan
// ---------------------------------------------------------------------------

interface LoadedModel {
  session: ort.InferenceSession
  tokenizer: GLiNERTokenizer
}

let modelPromise: Promise<LoadedModel | null> | null = null

async function loadModel(): Promise<LoadedModel | null> {
  try {
    // Point WASM worker to the extension's bundled assets
    ort.env.wasm.wasmPaths = resolveAssetUrl('assets/')
    ort.env.wasm.numThreads = 1  // single-threaded for MV3 service-worker compat

    const modelUrl = resolveAssetUrl('assets/models/gliner-small.onnx')
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'basic',
      enableCpuMemArena: false,
    })

    const tokenizer = new GLiNERTokenizer()
    const vocabUrl = resolveAssetUrl('assets/models/gliner-vocab.txt')
    await tokenizer.load(vocabUrl)

    if (!tokenizer.isLoaded()) {
      console.warn('[Sentinel GLiNER] Vocabulary not loaded; ML inference disabled')
      return null
    }

    console.info('[Sentinel GLiNER] Model loaded successfully')
    return { session, tokenizer }
  } catch (err) {
    console.warn('[Sentinel GLiNER] Model unavailable, falling back to regex detection:', (err as Error).message)
    return null
  }
}

/** Call once (e.g. at extension startup) to begin background model load. */
export function initGLiNER(): void {
  if (!modelPromise) {
    modelPromise = loadModel()
  }
}

async function getModel(): Promise<LoadedModel | null> {
  if (!modelPromise) {
    modelPromise = loadModel()
  }
  return modelPromise
}

// ---------------------------------------------------------------------------
// Span candidate construction
// ---------------------------------------------------------------------------

/**
 * For `numWords` words, build the flat arrays that GLiNER expects:
 *   spanIdx  – shape [numSpans, 2], each row is [startWord, endWord) (exclusive)
 *   spanMask – shape [numSpans]
 *
 * We enumerate every (i, j) pair with j - i ≤ MAX_SPAN_LENGTH.
 */
function buildSpanArrays(numWords: number): { spanIdx: Int32Array; spanMask: Uint8Array } {
  const spans: [number, number][] = []
  for (let i = 0; i < numWords; i++) {
    for (let j = i + 1; j <= Math.min(i + MAX_SPAN_LENGTH, numWords); j++) {
      spans.push([i, j])
    }
  }

  const spanIdx = new Int32Array(spans.length * 2)
  const spanMask = new Uint8Array(spans.length)

  for (let s = 0; s < spans.length; s++) {
    spanIdx[s * 2] = spans[s][0]
    spanIdx[s * 2 + 1] = spans[s][1]
    spanMask[s] = 1
  }

  return { spanIdx, spanMask }
}

/**
 * Build the words_mask tensor: 1 at the first subword of each word, 0 elsewhere.
 */
function buildWordsMask(wordIds: (number | null)[]): Int32Array {
  const mask = new Int32Array(wordIds.length)
  let prevWordIdx: number | null = null
  for (let i = 0; i < wordIds.length; i++) {
    const wi = wordIds[i]
    if (wi !== null && wi !== prevWordIdx) {
      mask[i] = 1
      prevWordIdx = wi
    }
  }
  return mask
}

// ---------------------------------------------------------------------------
// Recover original-text spans from word indices
// ---------------------------------------------------------------------------

function extractWordAtIndex(text: string, wordIdx: number): { value: string; start: number; end: number } | null {
  const words = text.match(/\w+(?:'\w+)?|[^\w\s]/g)
  if (!words || wordIdx >= words.length) return null

  let charPos = 0
  for (let i = 0; i < wordIdx; i++) {
    const idx = text.indexOf(words[i], charPos)
    if (idx === -1) return null
    charPos = idx + words[i].length
  }

  const word = words[wordIdx]
  const start = text.indexOf(word, charPos)
  if (start === -1) return null
  return { value: word, start, end: start + word.length }
}

function extractSpanText(
  text: string,
  startWordIdx: number,
  endWordIdx: number,  // exclusive
): { value: string; start: number; end: number } | null {
  const firstToken = extractWordAtIndex(text, startWordIdx)
  const lastToken = extractWordAtIndex(text, endWordIdx - 1)
  if (!firstToken || !lastToken) return null

  const value = text.slice(firstToken.start, lastToken.end).trim()
  if (!value) return null
  return { value, start: firstToken.start, end: lastToken.end }
}

// ---------------------------------------------------------------------------
// Main inference function
// ---------------------------------------------------------------------------

/**
 * Run GLiNER-small inference on a plain-text excerpt.
 *
 * Returns an array of PIIMatch objects with `detectedBy: 'ml'`.
 * Returns an empty array (never throws) if the model is unavailable.
 */
export async function detectPIIWithGLiNER(text: string): Promise<PIIMatch[]> {
  const model = await getModel()
  if (!model) return []

  const { session, tokenizer } = model

  // Strip HTML tags for text-level NER
  const plainText = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000)  // cap input length

  if (!plainText) return []

  try {
    const encoding = tokenizer.encode(ENTITY_LABELS, plainText, MAX_TEXT_LENGTH)
    const seqLen = encoding.inputIds.length

    // Count actual words from the text portion of wordIds
    const textWordIds = encoding.wordIds.filter((w) => w !== null) as number[]
    const numWords = textWordIds.length > 0 ? Math.max(...textWordIds) + 1 : 0
    if (numWords === 0) return []

    const { spanIdx, spanMask } = buildSpanArrays(numWords)
    const numSpans = spanMask.length
    if (numSpans === 0) return []

    const wordsMask = buildWordsMask(encoding.wordIds)

    // Build ONNX tensors
    const inputIdsTensor = new ort.Tensor('int64', BigInt64Array.from(encoding.inputIds.map(BigInt)), [1, seqLen])
    const attentionMaskTensor = new ort.Tensor('int64', BigInt64Array.from(encoding.attentionMask.map(BigInt)), [1, seqLen])
    const tokenTypeIdsTensor = new ort.Tensor('int64', BigInt64Array.from(encoding.tokenTypeIds.map(BigInt)), [1, seqLen])
    const wordsMaskTensor = new ort.Tensor('int64', BigInt64Array.from(Array.from(wordsMask).map(BigInt)), [1, seqLen])
    const spanIdxTensor = new ort.Tensor('int64', BigInt64Array.from(Array.from(spanIdx).map(BigInt)), [1, numSpans, 2])
    const spanMaskTensor = new ort.Tensor('bool', spanMask, [1, numSpans])

    const feeds: Record<string, ort.Tensor> = {
      input_ids: inputIdsTensor,
      attention_mask: attentionMaskTensor,
      token_type_ids: tokenTypeIdsTensor,
      words_mask: wordsMaskTensor,
      span_idx: spanIdxTensor,
      span_mask: spanMaskTensor,
    }

    const outputs = await session.run(feeds)
    // logits shape: [1, numSpans, numEntityTypes]
    const logits = outputs['logits']
    if (!logits) return []

    const logitData = logits.data as Float32Array
    const numEntityTypes = ENTITY_LABELS.length

    const matches: PIIMatch[] = []
    const seen = new Set<string>()

    for (let s = 0; s < numSpans; s++) {
      for (let e = 0; e < numEntityTypes; e++) {
        const rawScore = logitData[s * numEntityTypes + e]
        // GLiNER logits are pre-sigmoid in most exports
        const confidence = 1 / (1 + Math.exp(-rawScore))

        if (confidence < CONFIDENCE_THRESHOLD) continue

        const startWord = Number(spanIdx[s * 2])
        const endWord = Number(spanIdx[s * 2 + 1])
        const span = extractSpanText(plainText, startWord, endWord)
        if (!span) continue

        const spec = ENTITY_SPECS[e]
        const key = `${spec.category}:${span.value}`
        if (seen.has(key)) continue
        seen.add(key)

        matches.push({
          type: spec.category,
          value: span.value,
          redacted: redact(span.value, spec.category),
          location: {
            source: 'dom',
            textOffset: { start: span.start, end: span.end },
          },
          confidence: Math.round(confidence * 100) / 100,
          risk: spec.risk,
          action: spec.action,
          detectedBy: 'ml',
        })
      }
    }

    return matches
  } catch (err) {
    console.warn('[Sentinel GLiNER] Inference error:', (err as Error).message)
    return []
  }
}
