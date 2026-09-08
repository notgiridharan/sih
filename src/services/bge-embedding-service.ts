/**
 * BGE-small-en-v1.5 local embedding service.
 *
 * Runs inference entirely in the browser via ONNX Runtime Web (WASM).
 * No data leaves the device.
 *
 * Model: assets/models/bge-small-en-v1.5-quantized.onnx
 *   Architecture: 6-layer BERT, hidden=384, 12 heads, INT8-quantized (~22 MB)
 *   Inputs:  input_ids, attention_mask, token_type_ids  — int64 [batch, seq]
 *   Outputs: last_hidden_state [batch, seq, 384], pooler_output [batch, 384]
 *
 * Embedding extraction: L2-normalised CLS token (index 0 of last_hidden_state).
 * This is the BGE-spec representation for semantic-similarity tasks.
 *
 * When the model file is absent initBGE() silently resolves to null and all
 * public functions return null/empty so callers degrade gracefully.
 */

import * as ort from 'onnxruntime-web'
import { BgeTokenizer, BGE_MAX_SEQ_LEN } from './bge-tokenizer'

const MODEL_PATH  = 'assets/models/bge-small-en-v1.5-quantized.onnx'
const VOCAB_PATH  = 'assets/models/gliner-vocab.txt'
const EMBED_DIM   = 384

export interface RelevantPassage {
  index: number
  score: number
  text: string
}

// ---------------------------------------------------------------------------
// ORT configuration (shared with other services — idempotent)
// ---------------------------------------------------------------------------

let ortConfigured = false
function configureOrt(): void {
  if (ortConfigured) return
  ortConfigured = true
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    ort.env.wasm.wasmPaths = chrome.runtime.getURL('assets/')
  }
  ort.env.wasm.numThreads = 1
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

let session: ort.InferenceSession | null = null
let tokenizer: BgeTokenizer | null = null
let initPromise: Promise<boolean> | null = null   // true = ready, false = failed

async function load(): Promise<boolean> {
  try {
    configureOrt()

    const modelUrl =
      typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL(MODEL_PATH)
        : MODEL_PATH

    const vocabUrl =
      typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL(VOCAB_PATH)
        : VOCAB_PATH

    const tok = new BgeTokenizer()
    await tok.load(vocabUrl)

    const sess = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'basic',
      enableCpuMemArena: false,
    })

    tokenizer = tok
    session   = sess
    return true
  } catch (err) {
    console.warn('[Sentinel BGE] Model load failed:', (err as Error).message)
    return false
  }
}

/**
 * Pre-load the model.  Returns true when ready, false when unavailable.
 * Safe to call multiple times — subsequent calls return the cached promise.
 */
export function initBGE(): Promise<boolean> {
  if (!initPromise) initPromise = load()
  return initPromise
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

function l2normalize(vec: Float32Array): Float32Array {
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm)
  if (norm < 1e-12) return vec
  const out = new Float32Array(vec.length)
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm
  return out
}

/**
 * Run inference on `text` and return the L2-normalised CLS-token embedding.
 * Returns null when the model is unavailable or inference fails.
 */
export async function embed(text: string): Promise<Float32Array | null> {
  // Ensure model is loaded
  const ready = session ? true : (initPromise ? await initPromise : await initBGE())
  if (!ready || !session || !tokenizer) return null

  try {
    const enc = tokenizer.encode(text, BGE_MAX_SEQ_LEN)
    const seqLen = enc.seqLen

    const feeds: Record<string, ort.Tensor> = {
      input_ids:      new ort.Tensor('int64', enc.inputIds,      [1, BGE_MAX_SEQ_LEN]),
      attention_mask: new ort.Tensor('int64', enc.attentionMask, [1, BGE_MAX_SEQ_LEN]),
      token_type_ids: new ort.Tensor('int64', enc.tokenTypeIds,  [1, BGE_MAX_SEQ_LEN]),
    }

    const output = await session.run(feeds)

    // last_hidden_state: [1, seqLen, 384] — extract CLS (position 0)
    const lhs = output['last_hidden_state'] ?? output[Object.keys(output)[0]]
    const data = lhs.data as Float32Array
    // CLS token occupies positions [0 .. EMBED_DIM-1] in the flattened tensor
    const cls = data.slice(0, EMBED_DIM)
    return l2normalize(cls)
  } catch (err) {
    console.warn('[Sentinel BGE] Inference failed:', (err as Error).message)
    return null
  }
}

/**
 * Cosine similarity between two L2-normalised embeddings.
 * Returns a value in [-1, 1].  Returns 0 for null/mismatched inputs.
 */
export function cosineSimilarity(a: Float32Array | null, b: Float32Array | null): number {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return Math.max(-1, Math.min(1, dot))
}

/**
 * Rank `passages` by semantic similarity to `query`.
 *
 * Returns the top-`topK` passages (default: all) sorted by descending score.
 * Passages for which embedding fails are omitted from the result.
 */
export async function findRelevant(
  query: string,
  passages: string[],
  topK = passages.length,
): Promise<RelevantPassage[]> {
  if (passages.length === 0) return []

  const queryEmb = await embed(query)
  if (!queryEmb) return []

  const scored: RelevantPassage[] = []

  for (let i = 0; i < passages.length; i++) {
    const passEmb = await embed(passages[i])
    if (!passEmb) continue
    scored.push({
      index: i,
      score: cosineSimilarity(queryEmb, passEmb),
      text:  passages[i],
    })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}
