/**
 * BERT WordPiece tokenizer for BGE-small-en-v1.5 embedding inference.
 *
 * Shares the `assets/models/gliner-vocab.txt` vocabulary file with the GLiNER
 * PII detector (both use the bert-base-uncased 30 522-token vocabulary).
 *
 * Input format (BGE spec):
 *   [CLS] token1 token2 … [SEP]  (no entity markers)
 *
 * Returns int64 tensors so they can be fed directly to ONNX Runtime Web.
 */

const SPECIAL: Record<string, number> = {
  '[PAD]': 0,
  '[UNK]': 100,
  '[CLS]': 101,
  '[SEP]': 102,
  '[MASK]': 103,
}

const CLS_ID = 101
const SEP_ID = 102
const PAD_ID = 0
const UNK_ID = 100

export const BGE_MAX_SEQ_LEN = 512

export interface BgeEncoding {
  inputIds:      BigInt64Array
  attentionMask: BigInt64Array
  tokenTypeIds:  BigInt64Array
  seqLen: number
}

export class BgeTokenizer {
  private vocab = new Map<string, number>(Object.entries(SPECIAL))
  private loaded = false

  async load(vocabUrl: string): Promise<void> {
    try {
      const resp = await fetch(vocabUrl)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const text = await resp.text()
      const lines = text.split('\n')
      const vocab = new Map<string, number>()
      for (let i = 0; i < lines.length; i++) {
        const tok = lines[i].trim()
        if (tok) vocab.set(tok, i)
      }
      this.vocab = vocab
      this.loaded = true
    } catch {
      // Keep minimal special-tokens fallback
    }
  }

  isLoaded(): boolean { return this.loaded }

  private wordpiece(word: string): number[] {
    if (this.vocab.has(word)) return [this.vocab.get(word)!]
    const pieces: number[] = []
    let rem = word
    let first = true
    while (rem.length > 0) {
      let found = false
      for (let end = rem.length; end > 0; end--) {
        const cand = first ? rem.slice(0, end) : `##${rem.slice(0, end)}`
        if (this.vocab.has(cand)) {
          pieces.push(this.vocab.get(cand)!)
          rem = rem.slice(end)
          first = false
          found = true
          break
        }
      }
      if (!found) { pieces.push(UNK_ID); break }
    }
    return pieces
  }

  /**
   * Encode `text` into tensors of length `maxLen` (default BGE_MAX_SEQ_LEN).
   * Format: [CLS] subwords … [SEP], zero-padded to `maxLen`.
   */
  encode(text: string, maxLen = BGE_MAX_SEQ_LEN): BgeEncoding {
    const words = text.toLowerCase().match(/[a-z0-9']+|[^a-z0-9\s]/g) ?? []
    const tokenIds: number[] = []
    for (const w of words) {
      const pieces = this.wordpiece(w)
      for (const p of pieces) {
        if (tokenIds.length >= maxLen - 2) break
        tokenIds.push(p)
      }
    }

    const seqTokens = [CLS_ID, ...tokenIds, SEP_ID]
    const seqLen = seqTokens.length

    const inputIds      = new BigInt64Array(maxLen).fill(BigInt(PAD_ID))
    const attentionMask = new BigInt64Array(maxLen).fill(0n)
    const tokenTypeIds  = new BigInt64Array(maxLen).fill(0n)

    for (let i = 0; i < seqLen; i++) {
      inputIds[i]      = BigInt(seqTokens[i])
      attentionMask[i] = 1n
    }

    return { inputIds, attentionMask, tokenTypeIds, seqLen }
  }
}
