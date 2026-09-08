import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { cpSync, existsSync, mkdirSync } from 'fs'

// Vite plugin: copies ONNX WASM runtime files into the build output so
// chrome.runtime.getURL('assets/ort-wasm-*.wasm') resolves correctly.
function copyOrtWasm() {
  return {
    name: 'copy-ort-wasm',
    closeBundle() {
      const ortDist = resolve(__dirname, 'node_modules/onnxruntime-web/dist')
      const outAssets = resolve(__dirname, 'dist-extension/assets')
      if (!existsSync(outAssets)) mkdirSync(outAssets, { recursive: true })

      const wasmFiles = [
        'ort-wasm-simd-threaded.wasm',
        'ort-wasm-simd-threaded.asyncify.wasm',
      ]
      for (const f of wasmFiles) {
        const src = resolve(ortDist, f)
        if (existsSync(src)) cpSync(src, resolve(outAssets, f))
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const isExtension = mode === 'extension'

  return {
    plugins: [react(), ...(isExtension ? [copyOrtWasm()] : [])],
    base: isExtension ? './' : '/',
    // Mark onnxruntime-web as external in the Vite bundle so it imports from
    // the bundled ESM entry; the WASM files are copied separately.
    build: isExtension
      ? {
          outDir: 'dist-extension',
          rollupOptions: {
            input: { index: 'index.html', widget: 'widget.html' },
          },
        }
      : {},
    optimizeDeps: {
      exclude: ['onnxruntime-web'],
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  }
})
