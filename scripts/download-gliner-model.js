/**
 * Downloads GLiNER-small v1 ONNX model and BERT vocabulary into
 * extension/assets/models/ so the extension can run local ML inference.
 *
 * Usage:  node scripts/download-gliner-model.js
 *
 * Downloads ~22 MB of data (int8-quantized ONNX model + BERT vocab).
 * All files are stored locally — nothing is uploaded anywhere.
 *
 * Files saved:
 *   extension/assets/models/gliner-small.onnx   (int8 quantized, ~22 MB)
 *   extension/assets/models/gliner-vocab.txt     (BERT WordPiece vocab, ~230 KB)
 */

import { createWriteStream, mkdirSync, existsSync } from 'fs'
import { pipeline } from 'stream/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import https from 'https'

const __dirname = dirname(fileURLToPath(import.meta.url))
const modelsDir = resolve(__dirname, '..', 'extension', 'assets', 'models')

if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true })

// GLiNER-small v1 int8 quantized ONNX model (hosted on Hugging Face)
const FILES = [
  {
    url: 'https://huggingface.co/urchade/gliner_small/resolve/main/onnx/model_quantized.onnx',
    dest: resolve(modelsDir, 'gliner-small.onnx'),
    label: 'GLiNER-small ONNX (int8 quantized)',
  },
  {
    url: 'https://huggingface.co/bert-base-uncased/resolve/main/vocab.txt',
    dest: resolve(modelsDir, 'gliner-vocab.txt'),
    label: 'BERT vocabulary',
  },
]

function download(url, dest, label) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${label} ...`)

    const file = createWriteStream(dest)
    const req = https.get(url, { headers: { 'User-Agent': 'Sentinel-Extension/0.2.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow single redirect
        file.close()
        return download(res.headers.location, dest, label).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }

      const total = parseInt(res.headers['content-length'] || '0', 10)
      let received = 0

      res.on('data', (chunk) => {
        received += chunk.length
        if (total > 0) {
          process.stdout.write(`\r  ${((received / total) * 100).toFixed(1)}% (${(received / 1024 / 1024).toFixed(1)} MB)`)
        }
      })

      pipeline(res, file)
        .then(() => { process.stdout.write('\n'); resolve() })
        .catch(reject)
    })

    req.on('error', reject)
  })
}

for (const { url, dest, label } of FILES) {
  if (existsSync(dest)) {
    console.log(`Already exists: ${dest}`)
    continue
  }
  await download(url, dest, label)
  console.log(`Saved: ${dest}`)
}

console.log('\nModel assets ready. Run `npm run build:extension` to include them in the build.')
