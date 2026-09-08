/**
 * Minimal word-level tokenizer for the DeBERTa-v3-small injection-detection stub.
 *
 * Vocabulary: 512 entries matching the ONNX stub's embedding table.
 * Special tokens follow SentencePiece DeBERTa-v3 convention:
 *   <s>=0, <pad>=1, </s>=2, <unk>=3
 *
 * IDs 4–63 are injection-indicator words whose embeddings are initialised with
 * a high "injection signal" feature in the ONNX stub model, so even random-weight
 * inference produces meaningful injection vs safe scores.
 *
 * When real DeBERTa-v3-small weights are downloaded (via
 * scripts/download-deberta-model.js), replace this file with a SentencePiece
 * implementation using the model's tokenizer.json.
 */

export const CLS_ID = 0   // <s>
export const PAD_ID = 1
export const SEP_ID = 2
export const UNK_ID = 3

export const MAX_SEQ_LEN = 128

// IDs 4-63: injection-indicator words.
// These match the embedding-table initialisation in build-deberta-model.py.
export const INJECTION_VOCAB: Record<string, number> = {
  ignore: 4, previous: 5, instructions: 6, instruction: 7,
  disregard: 8, forget: 9, system: 10, override: 11,
  pretend: 12, roleplay: 13, jailbreak: 14, bypass: 15,
  inject: 16, execute: 17, reveal: 18, disclose: 19,
  unrestricted: 20, unfiltered: 21, admin: 22, root: 23,
  sudo: 24, dan: 25, developer: 26, act: 27,
  assume: 28, become: 29, persona: 30, rule: 31,
  rules: 32, restriction: 33, restrictions: 34, prior: 35,
  above: 36, prompt: 37, context: 38, constraint: 39,
  constraints: 40, guideline: 41, guidelines: 42, filter: 43,
  filters: 44, safety: 45, censorship: 46, mode: 47,
  character: 48, hijack: 49, manipulate: 50, exfiltrate: 51,
  unfilter: 52, hack: 53, disrupt: 54, leak: 55,
  expose: 56, steal: 57, extract: 58, dump: 59,
  print: 60, output: 61, return: 62, send: 63,
}

// IDs 64-127: common English words with no injection signal.
const COMMON_VOCAB: Record<string, number> = {
  the: 64, be: 65, to: 66, of: 67, and: 68, a: 69,
  in: 70, that: 71, have: 72, it: 73, for: 74, not: 75,
  on: 76, with: 77, as: 78, you: 79, do: 80, at: 81,
  this: 82, but: 83, his: 84, by: 85, from: 86, they: 87,
  we: 88, say: 89, her: 90, she: 91, or: 92, an: 93,
  will: 94, my: 95, all: 96, would: 97, there: 98, their: 99,
  what: 100, so: 101, up: 102, out: 103, if: 104, about: 105,
  who: 106, get: 107, which: 108, go: 109, me: 110, when: 111,
  make: 112, can: 113, like: 114, time: 115, no: 116, just: 117,
  him: 118, know: 119, take: 120, people: 121, into: 122, your: 123,
  good: 124, some: 125, could: 126, them: 127,
}

const VOCAB: Record<string, number> = { ...COMMON_VOCAB, ...INJECTION_VOCAB }

export interface DeBERTaEncoding {
  inputIds: BigInt64Array
  attentionMask: BigInt64Array
  tokenTypeIds: BigInt64Array
  length: number
}

function tokenize(text: string): number[] {
  const words = text.toLowerCase().match(/\b[a-z]+\b/g) ?? []
  return words.map(w => VOCAB[w] ?? UNK_ID)
}

/**
 * Encode text into DeBERTa input tensors.
 * Format: [CLS] word1 word2 ... wordN [SEP], padded to MAX_SEQ_LEN.
 */
export function encode(text: string): DeBERTaEncoding {
  const wordIds = tokenize(text)
  const maxContent = MAX_SEQ_LEN - 2
  const contentIds = wordIds.slice(0, maxContent)
  const tokens = [CLS_ID, ...contentIds, SEP_ID]
  const seqLen = tokens.length

  const inputIds = new BigInt64Array(MAX_SEQ_LEN).fill(BigInt(PAD_ID))
  const attentionMask = new BigInt64Array(MAX_SEQ_LEN).fill(0n)
  const tokenTypeIds = new BigInt64Array(MAX_SEQ_LEN).fill(0n)

  for (let i = 0; i < seqLen; i++) {
    inputIds[i] = BigInt(tokens[i])
    attentionMask[i] = 1n
  }

  return { inputIds, attentionMask, tokenTypeIds, length: seqLen }
}
