/**
 * Selects the best available LLM provider for the current runtime context.
 *
 * Tries QwenLLMProvider (WebGPU) when navigator.gpu is present; falls back to
 * MockLLMProvider in environments without WebGPU (service workers, non-GPU
 * browsers, Node.js/jsdom).
 */

import type { LLMProvider, ThinkingCallback } from './llm-service'
import { MockLLMProvider } from './llm-service'
import { QwenLLMProvider } from './qwen-planner'

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
 * - QwenLLMProvider (real Qwen3-0.6B inference via WebGPU) when WebGPU is present
 * - MockLLMProvider as fallback when WebGPU is unavailable
 */
export function selectLLMProvider(opts: ProviderOptions = {}): LLMProvider & { _providerName: string } {
  if (isWebGpuAvailable()) {
    return Object.assign(
      new QwenLLMProvider({ onThinking: opts.onThinking, signal: opts.signal }),
      { _providerName: 'qwen' },
    )
  }
  return Object.assign(
    new MockLLMProvider({ latencyMs: 800, onThinking: opts.onThinking, signal: opts.signal }),
    { _providerName: 'mock' },
  )
}
