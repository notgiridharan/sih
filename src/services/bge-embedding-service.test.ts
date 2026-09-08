import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BgeTokenizer, BGE_MAX_SEQ_LEN } from './bge-tokenizer'
import type { RelevantPassage } from './bge-embedding-service'

// ---------------------------------------------------------------------------
// BgeTokenizer unit tests (no model needed)
// ---------------------------------------------------------------------------

describe('BgeTokenizer – encode()', () => {
  let tok: BgeTokenizer

  beforeEach(() => {
    tok = new BgeTokenizer()
  })

  it('starts with CLS (101) and ends with SEP (102)', () => {
    const enc = tok.encode('hello world')
    expect(Number(enc.inputIds[0])).toBe(101)
    const last = Number(enc.inputIds[enc.seqLen - 1])
    expect(last).toBe(102)
  })

  it('produces arrays of length BGE_MAX_SEQ_LEN', () => {
    const enc = tok.encode('test sentence')
    expect(enc.inputIds.length).toBe(BGE_MAX_SEQ_LEN)
    expect(enc.attentionMask.length).toBe(BGE_MAX_SEQ_LEN)
    expect(enc.tokenTypeIds.length).toBe(BGE_MAX_SEQ_LEN)
  })

  it('sets attention mask 1 for real tokens, 0 for padding', () => {
    const enc = tok.encode('hi')
    for (let i = 0; i < enc.seqLen; i++) {
      expect(Number(enc.attentionMask[i])).toBe(1)
    }
    for (let i = enc.seqLen; i < BGE_MAX_SEQ_LEN; i++) {
      expect(Number(enc.attentionMask[i])).toBe(0)
    }
  })

  it('pads with 0 beyond seqLen', () => {
    const enc = tok.encode('short')
    for (let i = enc.seqLen; i < BGE_MAX_SEQ_LEN; i++) {
      expect(Number(enc.inputIds[i])).toBe(0)
    }
  })

  it('all tokenTypeIds are 0', () => {
    const enc = tok.encode('some text here')
    for (const v of enc.tokenTypeIds) expect(Number(v)).toBe(0)
  })

  it('truncates very long text so array fits BGE_MAX_SEQ_LEN', () => {
    const enc = tok.encode('word '.repeat(600))
    expect(enc.inputIds.length).toBe(BGE_MAX_SEQ_LEN)
    expect(enc.seqLen).toBe(BGE_MAX_SEQ_LEN)
    expect(Number(enc.inputIds[BGE_MAX_SEQ_LEN - 1])).toBe(102) // SEP
  })

  it('empty string gives [CLS, SEP] followed by padding', () => {
    const enc = tok.encode('')
    expect(Number(enc.inputIds[0])).toBe(101)
    expect(Number(enc.inputIds[1])).toBe(102)
    expect(enc.seqLen).toBe(2)
    expect(Number(enc.attentionMask[0])).toBe(1)
    expect(Number(enc.attentionMask[1])).toBe(1)
    expect(Number(enc.attentionMask[2])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Embedding service – model-absent fallback (graceful degradation)
// ---------------------------------------------------------------------------

vi.mock('onnxruntime-web', () => ({
  InferenceSession: {
    create: vi.fn().mockRejectedValue(new Error('Model file not found')),
  },
  // Must use a regular function so `new ort.Tensor(...)` works
  // eslint-disable-next-line prefer-arrow-callback
  Tensor: vi.fn().mockImplementation(function(type: string, data: unknown, dims: number[]) {
    return { type, data, dims }
  }),
  env: { wasm: {} as Record<string, unknown> },
}))

describe('BGE embedding service – no model', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('initBGE resolves false when model file is absent', async () => {
    const { initBGE } = await import('./bge-embedding-service')
    const ready = await initBGE()
    expect(ready).toBe(false)
  })

  it('embed returns null when model is unavailable', async () => {
    const { initBGE, embed } = await import('./bge-embedding-service')
    await initBGE()
    const result = await embed('hello world')
    expect(result).toBeNull()
  })

  it('embed never throws', async () => {
    const { initBGE, embed } = await import('./bge-embedding-service')
    await initBGE()
    await expect(embed('any text')).resolves.not.toThrow()
  })

  it('findRelevant returns [] when model is unavailable', async () => {
    const { initBGE, findRelevant } = await import('./bge-embedding-service')
    await initBGE()
    const results = await findRelevant('query', ['passage one', 'passage two'])
    expect(results).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// cosineSimilarity – pure function, no model needed
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('identical unit vectors have similarity 1', async () => {
    const { cosineSimilarity } = await import('./bge-embedding-service')
    const a = new Float32Array([1, 0, 0])
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5)
  })

  it('orthogonal vectors have similarity 0', async () => {
    const { cosineSimilarity } = await import('./bge-embedding-service')
    const a = new Float32Array([1, 0])
    const b = new Float32Array([0, 1])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5)
  })

  it('opposite vectors have similarity -1', async () => {
    const { cosineSimilarity } = await import('./bge-embedding-service')
    const a = new Float32Array([1, 0])
    const b = new Float32Array([-1, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5)
  })

  it('returns 0 for null inputs', async () => {
    const { cosineSimilarity } = await import('./bge-embedding-service')
    expect(cosineSimilarity(null, new Float32Array([1]))).toBe(0)
    expect(cosineSimilarity(new Float32Array([1]), null)).toBe(0)
    expect(cosineSimilarity(null, null)).toBe(0)
  })

  it('returns 0 for mismatched lengths', async () => {
    const { cosineSimilarity } = await import('./bge-embedding-service')
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([1, 0])
    expect(cosineSimilarity(a, b)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// embed – with working mock session
// ---------------------------------------------------------------------------

describe('embed – with mock session', () => {
  const FAKE_DIM = 384

  beforeEach(() => {
    vi.resetModules()

    // Create a fake last_hidden_state tensor:
    // Shape [1, BGE_MAX_SEQ_LEN, 384] — CLS at position 0 is a unit vector in dim 0
    const lhs = new Float32Array(BGE_MAX_SEQ_LEN * FAKE_DIM)
    lhs[0] = 1.0   // CLS[0] = 1.0 → after normalisation: [1, 0, 0, …]

    vi.doMock('onnxruntime-web', () => ({
      InferenceSession: {
        create: vi.fn().mockResolvedValue({
          run: vi.fn().mockResolvedValue({
            last_hidden_state: {
              data: lhs,
              dims: [1, BGE_MAX_SEQ_LEN, FAKE_DIM],
            },
          }),
        }),
      },
      // Must use a regular function so `new ort.Tensor(...)` works
      // eslint-disable-next-line prefer-arrow-callback
      Tensor: vi.fn().mockImplementation(function(type: string, data: unknown, dims: number[]) {
        return { type, data, dims }
      }),
      env: { wasm: {} as Record<string, unknown> },
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns a Float32Array of length 384', async () => {
    const { initBGE, embed } = await import('./bge-embedding-service')
    await initBGE()
    const result = await embed('hello world')
    expect(result).toBeInstanceOf(Float32Array)
    expect(result!.length).toBe(FAKE_DIM)
  })

  it('output is L2-normalised (unit vector)', async () => {
    const { initBGE, embed } = await import('./bge-embedding-service')
    await initBGE()
    const result = await embed('hello')
    let norm = 0
    for (const v of result!) norm += v * v
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5)
  })

  it('cosine similarity between same text equals ~1', async () => {
    const { initBGE, embed, cosineSimilarity } = await import('./bge-embedding-service')
    await initBGE()
    const a = await embed('hello world')
    const b = await embed('hello world')
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5)
  })

  it('findRelevant returns sorted passages', async () => {
    const { initBGE, findRelevant } = await import('./bge-embedding-service')
    await initBGE()
    const results: RelevantPassage[] = await findRelevant('query', ['p1', 'p2', 'p3'])
    // With identical CLS vectors all similarities are 1; at least we get 3 results
    expect(results).toHaveLength(3)
    // Sorted descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  it('findRelevant respects topK', async () => {
    const { initBGE, findRelevant } = await import('./bge-embedding-service')
    await initBGE()
    const results = await findRelevant('query', ['p1', 'p2', 'p3', 'p4'], 2)
    expect(results).toHaveLength(2)
  })

  it('findRelevant returns [] for empty passages array', async () => {
    const { initBGE, findRelevant } = await import('./bge-embedding-service')
    await initBGE()
    const results = await findRelevant('query', [])
    expect(results).toEqual([])
  })
})
