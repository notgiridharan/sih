import { cpSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const dist = resolve(root, 'dist-extension')
const ext = resolve(root, 'extension')

cpSync(resolve(ext, 'manifest.json'), resolve(dist, 'manifest.json'))
cpSync(resolve(ext, 'background.js'), resolve(dist, 'background.js'))
cpSync(resolve(ext, 'content-script.js'), resolve(dist, 'content-script.js'))

const iconsDir = resolve(dist, 'icons')
if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true })

if (existsSync(resolve(ext, 'icons'))) {
  cpSync(resolve(ext, 'icons'), iconsDir, { recursive: true })
}

// Copy ONNX Runtime Web WASM binaries into dist-extension/assets/
// so chrome.runtime.getURL('assets/ort-wasm-simd-threaded.wasm') resolves correctly.
const ortDist = resolve(root, 'node_modules/onnxruntime-web/dist')
const assetsDir = resolve(dist, 'assets')
if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true })

const wasmFiles = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.asyncify.wasm',
]
for (const f of wasmFiles) {
  const src = resolve(ortDist, f)
  if (existsSync(src)) {
    cpSync(src, resolve(assetsDir, f))
  }
}

// Copy ML model assets (GLiNER + PP-OCR) if present.
// Download them first with:
//   node scripts/download-gliner-model.js
//   node scripts/download-ppocr-models.js
const modelSrc = resolve(ext, 'assets', 'models')
const modelDst = resolve(assetsDir, 'models')
if (existsSync(modelSrc)) {
  if (!existsSync(modelDst)) mkdirSync(modelDst, { recursive: true })
  cpSync(modelSrc, modelDst, { recursive: true })
  console.log('Copied ML model assets to dist-extension/assets/models/')
} else {
  console.log('No ML models found at extension/assets/models/ — OCR and ML PII detection will use fallbacks.')
  console.log('To enable:')
  console.log('  node scripts/download-ppocr-models.js   # PP-OCRv5 for screenshot OCR')
  console.log('  node scripts/download-gliner-model.js   # GLiNER-small for ML PII detection')
}

console.log('Extension build complete: dist-extension/')
console.log('Load it in Chrome via chrome://extensions → Load unpacked → select dist-extension/')
