/**
 * BERT WordPiece tokenizer for GLiNER-small inference.
 *
 * Loads vocabulary from the extension asset `assets/models/gliner-vocab.txt`.
 * Each line in the file is one token; the token's ID equals its 0-based line
 * number, which is the standard BERT vocab format.
 *
 * Falls back to character-level unknown tokens if vocab hasn't been loaded.
 */

export interface TokenizerEncoding {
  inputIds: number[]
  attentionMask: number[]
  tokenTypeIds: number[]
  /** One-based word index for each token (0 = padding/special, ≥1 = nth word) */
  wordIds: (number | null)[]
}

const SPECIAL_TOKENS: Record<string, number> = {
  '[PAD]': 0,
  '[UNK]': 100,
  '[CLS]': 101,
  '[SEP]': 102,
  '[MASK]': 103,
}

// GLiNER uses these to delimit entity type labels in the input sequence.
// They are appended to the vocabulary after BERT's built-in tokens.
const GLINER_TOKENS: Record<string, number> = {
  '<<ENT>>': 30522,
  '<<SEP>>': 30523,
}

export class GLiNERTokenizer {
  private vocab: Map<string, number> = new Map(Object.entries({ ...SPECIAL_TOKENS, ...GLINER_TOKENS }))
  private loaded = false

  async load(vocabUrl: string): Promise<void> {
    try {
      const resp = await fetch(vocabUrl)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const text = await resp.text()
      const lines = text.split('\n')
      const vocab = new Map<string, number>()
      for (let i = 0; i < lines.length; i++) {
        const token = lines[i].trim()
        if (token) vocab.set(token, i)
      }
      // Merge GLINER special tokens (they must exist even if not in bert vocab)
      for (const [tok, id] of Object.entries(GLINER_TOKENS)) {
        vocab.set(tok, id)
      }
      this.vocab = vocab
      this.loaded = true
    } catch {
      // vocab load failed — keep minimal fallback vocab (only special tokens)
    }
  }

  isLoaded(): boolean {
    return this.loaded
  }

  private tokenId(token: string): number {
    return this.vocab.get(token) ?? SPECIAL_TOKENS['[UNK]']
  }

  /** Split a word into WordPiece subword units. */
  private wordpiece(word: string): string[] {
    if (this.vocab.has(word)) return [word]
    const pieces: string[] = []
    let remaining = word
    let first = true
    while (remaining.length > 0) {
      let found = false
      for (let end = remaining.length; end > 0; end--) {
        const candidate = first ? remaining.slice(0, end) : `##${remaining.slice(0, end)}`
        if (this.vocab.has(candidate)) {
          pieces.push(candidate)
          remaining = remaining.slice(end)
          first = false
          found = true
          break
        }
      }
      if (!found) {
        pieces.push('[UNK]')
        break
      }
    }
    return pieces
  }

  /** Tokenize raw text into an array of (subword, wordIndex) pairs. */
  private tokenizeText(text: string): Array<{ token: string; wordIdx: number | null }> {
    const pairs: Array<{ token: string; wordIdx: number | null }> = []

    // Split on whitespace and punctuation while preserving word boundaries.
    const words = text.toLowerCase().match(/\w+(?:'\w+)?|[^\w\s]/g) ?? []

    for (let w = 0; w < words.length; w++) {
      const word = words[w]
      const pieces = this.wordpiece(word)
      for (const piece of pieces) {
        pairs.push({ token: piece, wordIdx: w })
      }
    }
    return pairs
  }

  /**
   * Encode an entity label into a flat token-ID array (no CLS/SEP).
   * The label is lowercased and split on whitespace; each word is word-pieced.
   */
  encodeLabel(label: string): number[] {
    const ids: number[] = []
    const lower = label.toLowerCase()
    const words = lower.match(/\w+(?:'\w+)?/g) ?? []
    for (const w of words) {
      for (const piece of this.wordpiece(w)) {
        ids.push(this.tokenId(piece))
      }
    }
    return ids
  }

  /**
   * Build the full GLiNER input sequence:
   *
   *   [CLS] <<ENT>> label_1_tokens <<ENT>> label_2_tokens ... <<SEP>> text_tokens [SEP]
   *
   * Returns the encoding plus a `wordsIds` array that maps each token position
   * back to the word index in `text` (null for special/label tokens).
   */
  encode(labels: string[], text: string, maxLength = 512): TokenizerEncoding {
    const inputIds: number[] = []
    const wordIds: (number | null)[] = []

    // CLS
    inputIds.push(SPECIAL_TOKENS['[CLS]'])
    wordIds.push(null)

    // Entity labels
    for (const label of labels) {
      inputIds.push(GLINER_TOKENS['<<ENT>>'])
      wordIds.push(null)

      for (const id of this.encodeLabel(label)) {
        inputIds.push(id)
        wordIds.push(null)
      }
    }

    // GLiNER separator between labels and text
    inputIds.push(GLINER_TOKENS['<<SEP>>'])
    wordIds.push(null)

    // Text tokens
    const textPairs = this.tokenizeText(text)
    const labelTokenCount = inputIds.length // tokens used so far (including CLS, labels, <<SEP>>)
    const budgetForText = maxLength - labelTokenCount - 1 // -1 for trailing [SEP]

    for (let i = 0; i < Math.min(textPairs.length, budgetForText); i++) {
      const { token, wordIdx } = textPairs[i]
      inputIds.push(this.tokenId(token))
      wordIds.push(wordIdx)
    }

    // SEP
    inputIds.push(SPECIAL_TOKENS['[SEP]'])
    wordIds.push(null)

    const attentionMask = new Array(inputIds.length).fill(1)
    const tokenTypeIds = new Array(inputIds.length).fill(0)

    return { inputIds, attentionMask, tokenTypeIds, wordIds }
  }
}
