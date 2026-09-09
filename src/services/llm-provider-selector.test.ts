import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isWebGpuAvailable, selectLLMProvider } from './llm-provider-selector'

// ─── Module mocks ─────────────────────────────────────────────────────────────

// vi.hoisted ensures the fn exists before vi.mock is hoisted to the top
const { mockIsQwenReady } = vi.hoisted(() => ({
  mockIsQwenReady: vi.fn().mockReturnValue(false),
}))

vi.mock('./qwen-planner', () => ({
  QwenLLMProvider: vi.fn().mockImplementation(function(this: Record<string, unknown>, opts: Record<string, unknown>) {
    this.name = 'Qwen3-0.6B'
    this.isLocal = true
    this._opts = opts
    this.generatePlan = vi.fn()
  }),
  initQwen: vi.fn(),
  isQwenReady: mockIsQwenReady,
}))

vi.mock('./llm-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./llm-service')>()
  return {
    ...actual,
    MockLLMProvider: vi.fn().mockImplementation(function(this: Record<string, unknown>, opts: Record<string, unknown>) {
      this.name = 'Mock'
      this.isLocal = true
      this._opts = opts
      this.generatePlan = vi.fn()
    }),
  }
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('isWebGpuAvailable', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns true when navigator.gpu exists', () => {
    vi.stubGlobal('navigator', { gpu: {} })
    expect(isWebGpuAvailable()).toBe(true)
  })

  it('returns false when navigator.gpu is absent', () => {
    vi.stubGlobal('navigator', {})
    expect(isWebGpuAvailable()).toBe(false)
  })

  it('returns false when navigator is undefined', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isWebGpuAvailable()).toBe(false)
  })
})

describe('selectLLMProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns QwenLLMProvider when WebGPU is available AND engine is ready', async () => {
    vi.stubGlobal('navigator', { gpu: {} })
    mockIsQwenReady.mockReturnValue(true)

    const { QwenLLMProvider } = await import('./qwen-planner')
    const signal = new AbortController().signal
    const onThinking = vi.fn()

    const provider = selectLLMProvider({ onThinking, signal })

    expect(QwenLLMProvider).toHaveBeenCalledOnce()
    expect(QwenLLMProvider).toHaveBeenCalledWith({ onThinking, signal })
    expect(provider._providerName).toBe('qwen')
    expect(provider.name).toBe('Qwen3-0.6B')
  })

  it('returns MockLLMProvider when WebGPU is available but engine is NOT yet ready', async () => {
    vi.stubGlobal('navigator', { gpu: {} })
    mockIsQwenReady.mockReturnValue(false)

    const { MockLLMProvider } = await import('./llm-service')
    const provider = selectLLMProvider()

    expect(MockLLMProvider).toHaveBeenCalledOnce()
    expect(provider._providerName).toBe('mock')
  })

  it('returns MockLLMProvider when WebGPU is absent', async () => {
    vi.stubGlobal('navigator', {})

    const { MockLLMProvider } = await import('./llm-service')
    const signal = new AbortController().signal
    const onThinking = vi.fn()

    const provider = selectLLMProvider({ onThinking, signal })

    expect(MockLLMProvider).toHaveBeenCalledOnce()
    expect(MockLLMProvider).toHaveBeenCalledWith({ latencyMs: 400, onThinking, signal })
    expect(provider._providerName).toBe('mock')
    expect(provider.name).toBe('Mock')
  })

  it('returns MockLLMProvider when navigator is undefined', async () => {
    vi.stubGlobal('navigator', undefined)

    const { MockLLMProvider } = await import('./llm-service')

    const provider = selectLLMProvider()

    expect(MockLLMProvider).toHaveBeenCalledOnce()
    expect(provider._providerName).toBe('mock')
  })

  it('works without opts — uses defaults', () => {
    vi.stubGlobal('navigator', {})

    expect(() => selectLLMProvider()).not.toThrow()
  })

  it('passes signal to the provider (Qwen when ready)', () => {
    vi.stubGlobal('navigator', { gpu: {} })
    mockIsQwenReady.mockReturnValue(true)

    const controller = new AbortController()
    const provider = selectLLMProvider({ signal: controller.signal })

    expect(provider._providerName).toBe('qwen')
  })

  it('passes onThinking callback to the provider', async () => {
    vi.stubGlobal('navigator', {})

    const { MockLLMProvider } = await import('./llm-service')
    const onThinking = vi.fn()

    selectLLMProvider({ onThinking })

    const callArgs = (MockLLMProvider as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(callArgs.onThinking).toBe(onThinking)
  })

  it('Mock provider uses latencyMs=400', async () => {
    vi.stubGlobal('navigator', {})

    const { MockLLMProvider } = await import('./llm-service')

    selectLLMProvider()

    const callArgs = (MockLLMProvider as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(callArgs.latencyMs).toBe(400)
  })

  it('returned provider implements LLMProvider interface (Mock when engine not ready)', () => {
    vi.stubGlobal('navigator', { gpu: {} })
    mockIsQwenReady.mockReturnValue(false)

    const provider = selectLLMProvider()

    expect(typeof provider.name).toBe('string')
    expect(typeof provider.isLocal).toBe('boolean')
    expect(typeof provider.generatePlan).toBe('function')
  })
})
