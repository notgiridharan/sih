/**
 * Selects the best available LLM provider for the current runtime context.
 *
 * Tries QwenLLMProvider (WebGPU) when navigator.gpu is present; falls back to
 * MockLLMProvider in environments without WebGPU (service workers, non-GPU
 * browsers, Node.js/jsdom).
 */

import type { LLMProvider, ThinkingCallback } from './llm-service'
import { MockLLMProvider } from './llm-service'
import { QwenLLMProvider, isQwenReady } from './qwen-planner'

export interface ProviderOptions {
  onThinking?: ThinkingCallback
  signal?: AbortSignal
}

/**
 * Returns `true` when WebGPU is available in the current context.
 * Extracted for testability.
 */
export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

/**
 * Creates the best available LLM provider:
 * - QwenLLMProvider when WebGPU is present AND the engine is already fully
 *   initialised (i.e. the background initQwen() call completed).
 * - MockLLMProvider in all other cases — WebGPU unavailable, or Qwen is still
 *   loading.  This makes tasks execute instantly rather than waiting for the
 *   0.6B model to finish loading.  Qwen remains the preferred path once warm.
 */
export function selectLLMProvider(opts: ProviderOptions = {}): LLMProvider & { _providerName: string } {
  if (isWebGpuAvailable() && isQwenReady()) {
    return Object.assign(
      new QwenLLMProvider({ onThinking: opts.onThinking, signal: opts.signal }),
      { _providerName: 'qwen' },
    )
  }
  return Object.assign(
    new MockLLMProvider({ latencyMs: 400, onThinking: opts.onThinking, signal: opts.signal }),
    { _providerName: 'mock' },
  )
}
