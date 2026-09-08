/**
 * DeBERTa-v3-small local prompt-injection detector.
 *
 * Runs the ONNX stub (or real fine-tuned weights when available) entirely
 * inside the browser via ONNX Runtime Web (WASM execution provider).
 * No data is sent to any external service.
 *
 * Model file:  assets/models/deberta-injection.onnx
 * Inputs:  input_ids       int64 [1, 128]
 *          attention_mask  int64 [1, 128]
 *          token_type_ids  int64 [1, 128]
 * Output:  logits          float32 [1, 2]  (index 0 = SAFE, index 1 = INJECTION)
 *
 * When the model file is absent, detectInjectionWithDeBERTa() returns null
 * and the caller falls back to the existing regex detector automatically.
 */

import * as ort from 'onnxruntime-web'
import { encode, MAX_SEQ_LEN } from './deberta-tokenizer'
import type { PromptInjection } from '../types/scan'

export interface InjectionMLResult {
  isInjection: boolean
  riskScore: number     // 0–1 probability of injection
  confidence: number    // max(P_safe, P_injection)
  detectedBy: 'ml'
}

const MODEL_PATH = 'assets/models/deberta-injection.onnx'
const INJECTION_THRESHOLD = 0.5

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
// Session singleton
// ---------------------------------------------------------------------------

let session: ort.InferenceSession | null = null
let sessionPromise: Promise<ort.InferenceSession | null> | null = null

async function loadSession(): Promise<ort.InferenceSession | null> {
  try {
    const modelUrl =
      typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL(MODEL_PATH)
        : MODEL_PATH
    const s = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'basic',
      enableCpuMemArena: false,
    })
    session = s
    return s
  } catch (err) {
    console.warn('[Sentinel DeBERTa] Model load failed:', (err as Error).message)
    return null
  }
}

export function initDeBERTa(): Promise<ort.InferenceSession | null> {
  configureOrt()
  if (!sessionPromise) sessionPromise = loadSession()
  return sessionPromise
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

/**
 * Score `text` for prompt injection using DeBERTa.
 *
 * Returns null when the model is not yet loaded or inference fails, so the
 * caller can fall back to regex-based detection gracefully.
 */
export async function detectInjectionWithDeBERTa(text: string): Promise<InjectionMLResult | null> {
  const s = session ?? (sessionPromise ? await sessionPromise : null)
  if (!s) return null

  try {
    const enc = encode(text)

    const feeds: Record<string, ort.Tensor> = {
      input_ids:      new ort.Tensor('int64', enc.inputIds,      [1, MAX_SEQ_LEN]),
      attention_mask: new ort.Tensor('int64', enc.attentionMask, [1, MAX_SEQ_LEN]),
      token_type_ids: new ort.Tensor('int64', enc.tokenTypeIds,  [1, MAX_SEQ_LEN]),
    }

    const result = await s.run(feeds)
    const logitsTensor = result['logits'] ?? result[Object.keys(result)[0]]
    const logits = logitsTensor.data as Float32Array  // [safe, injection]

    // Numerically stable softmax over two classes
    const maxL = Math.max(logits[0], logits[1])
    const expSafe = Math.exp(logits[0] - maxL)
    const expInj  = Math.exp(logits[1] - maxL)
    const sum     = expSafe + expInj
    const probSafe = expSafe / sum
    const probInj  = expInj  / sum

    return {
      isInjection: probInj > INJECTION_THRESHOLD,
      riskScore:   probInj,
      confidence:  Math.max(probSafe, probInj),
      detectedBy:  'ml',
    }
  } catch (err) {
    console.warn('[Sentinel DeBERTa] Inference failed:', (err as Error).message)
    return null
  }
}

// ---------------------------------------------------------------------------
// Merge helper (used by scanner)
// ---------------------------------------------------------------------------

/**
 * Augment existing regex-found injections with the ML model score.
 *
 * - If ML agrees with regex findings, severity may be boosted.
 * - If ML detects injection but regex found nothing, a synthetic entry is
 *   added so the risk engine reflects the ML signal.
 * - If ML returns null (model absent), the regex results are returned unchanged.
 */
export function mergeInjectionResults(
  regexInjections: PromptInjection[],
  mlResult: InjectionMLResult | null,
  dom: string,
): PromptInjection[] {
  if (!mlResult?.isInjection) return regexInjections

  // Regex already found it — keep those; ML confirms but adds no new entry
  if (regexInjections.length > 0) return regexInjections

  // ML-only detection: add a synthetic entry so the UI/risk-engine sees it
  const severity: PromptInjection['severity'] =
    mlResult.riskScore > 0.9 ? 'critical' :
    mlResult.riskScore > 0.75 ? 'high' :
    mlResult.riskScore > 0.6  ? 'medium' : 'low'

  const snippet = dom.slice(0, 120).replace(/\s+/g, ' ').trim()

  return [{
    type: 'indirect',
    content: snippet,
    location: {
      source: 'dom',
      textOffset: { start: 0, end: Math.min(120, dom.length) },
    },
    severity,
  }]
}
