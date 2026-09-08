/**
 * PP-OCRv5 text recognition.
 *
 * Runs the CRNN-based recognition model (ONNX) on each text-region crop and
 * returns the recognised string plus a confidence score via CTC decode.
 *
 * Model file: assets/models/ppocr-v5-rec.onnx
 * Input:  "x"                  [1, 3, 48, W]   Float32
 * Output: "softmax_0.tmp_0"    [1, T, num_cls]  Float32  (log-softmax or softmax)
 *
 * Character dictionary: 95 printable ASCII characters (space–tilde, U+0020–U+007E).
 * Index 0 in the output is the CTC blank token; indices 1–95 map to the dict.
 */

import * as ort from 'onnxruntime-web'
import type { PreparedTensor } from './ppocr-image'

// ---------------------------------------------------------------------------
// English character dictionary  (space through tilde, 95 chars)
// ---------------------------------------------------------------------------
// CTC blank = class index 0
// class 1 → EN_DICT[0], class 2 → EN_DICT[1], ...
const EN_DICT =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
  '[\\]^_`' +
  'abcdefghijklmnopqrstuvwxyz' +
  '{|}~'

/** Result of recognising one text crop. */
export interface RecResult {
  text: string
  confidence: number
}

// ---------------------------------------------------------------------------
// CTC greedy decode
// ---------------------------------------------------------------------------

function ctcDecode(
  probs: Float32Array,
  seqLen: number,
  numClasses: number,
): RecResult {
  let lastIdx = -1
  const chars: string[] = []
  const charScores: number[] = []

  for (let t = 0; t < seqLen; t++) {
    const offset = t * numClasses
    let maxVal = -Infinity
    let maxIdx = 0

    for (let c = 0; c < numClasses; c++) {
      if (probs[offset + c] > maxVal) {
        maxVal = probs[offset + c]
        maxIdx = c
      }
    }

    // Skip blank (0) and consecutive duplicates
    if (maxIdx !== 0 && maxIdx !== lastIdx) {
      const ch = EN_DICT[maxIdx - 1]
      if (ch !== undefined) {
        chars.push(ch)
        // Probability is already softmax; use it directly as per-character confidence
        charScores.push(Math.min(Math.max(maxVal, 0), 1))
      }
    }
    lastIdx = maxIdx
  }

  const text = chars.join('')
  const confidence =
    charScores.length > 0
      ? charScores.reduce((a, b) => a + b, 0) / charScores.length
      : 0

  return { text, confidence }
}

// ---------------------------------------------------------------------------
// Session singleton
// ---------------------------------------------------------------------------

let recSession: ort.InferenceSession | null = null
let recSessionPromise: Promise<ort.InferenceSession | null> | null = null

async function loadRecSession(modelUrl: string): Promise<ort.InferenceSession | null> {
  try {
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'basic',
      enableCpuMemArena: false,
    })
    recSession = session
    return session
  } catch (err) {
    console.warn('[Sentinel PP-OCR rec] Model load failed:', (err as Error).message)
    return null
  }
}

export function initRecSession(modelUrl: string): Promise<ort.InferenceSession | null> {
  if (!recSessionPromise) recSessionPromise = loadRecSession(modelUrl)
  return recSessionPromise
}

export async function getRecSession(): Promise<ort.InferenceSession | null> {
  return recSession ?? recSessionPromise ?? null
}

// ---------------------------------------------------------------------------
// Main recognition function
// ---------------------------------------------------------------------------

/**
 * Recognise text in a single crop.
 *
 * @param session   Loaded ONNX rec session
 * @param prepared  Output from `prepareForRec()`
 */
export async function recogniseText(
  session: ort.InferenceSession,
  prepared: PreparedTensor,
): Promise<RecResult> {
  const { data, height: H, width: W } = prepared

  const inputTensor = new ort.Tensor('float32', data, [1, 3, H, W])
  const results = await session.run({ x: inputTensor })

  // Accept common output node names
  const outTensor =
    results['softmax_0.tmp_0'] ??
    results['out'] ??
    results[Object.keys(results)[0]]

  if (!outTensor) return { text: '', confidence: 0 }

  const outData = outTensor.data as Float32Array
  const dims = outTensor.dims  // [1, seqLen, numClasses]
  const seqLen = dims[1] as number
  const numClasses = dims[2] as number

  return ctcDecode(outData, seqLen, numClasses)
}
