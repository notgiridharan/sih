/**
 * Downloads PP-OCRv5 mobile ONNX models into extension/assets/models/.
 *
 * Usage:  node scripts/download-ppocr-models.js
 *
 * Files saved:
 *   extension/assets/models/ppocr-v5-det.onnx   (~2.3 MB)
 *   extension/assets/models/ppocr-v5-rec.onnx   (~11  MB)
 *
 * Source: PaddlePaddle / PaddleOCR model zoo via Hugging Face.
 * All files are stored locally — no data is uploaded anywhere.
 *
 * After downloading, run:
 *   npm run build:extension
 * to include the models in the extension package.
 */

import { createWriteStream, mkdirSync, existsSync } from 'fs'
import { pipeline } from 'stream/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import https from 'https'
import http from 'http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const modelsDir = resolve(__dirname, '..', 'extension', 'assets', 'models')

if (!existsSync(modelsDir)) mkdirSync(modelsDir, { recursive: true })

// PP-OCRv5 mobile models (ONNX) from Hugging Face PaddlePaddle model hub.
// The mobile variants are chosen for their lower memory footprint in a browser.
const FILES = [
  {
    // Detection: PP-OCRv5 mobile DBNet (finds text bounding boxes)
    url: 'https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det/resolve/main/model.onnx',
    dest: resolve(modelsDir, 'ppocr-v5-det.onnx'),
    label: 'PP-OCRv5 mobile detection model',
    fallbackUrl: 'https://huggingface.co/PaddlePaddle/PP-OCRv4_mobile_det/resolve/main/model.onnx',
  },
  {
    // Recognition: PP-OCRv5 mobile CRNN (reads text within each box)
    url: 'https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec/resolve/main/model.onnx',
    dest: resolve(modelsDir, 'ppocr-v5-rec.onnx'),
    label: 'PP-OCRv5 mobile recognition model',
    fallbackUrl: 'https://huggingface.co/PaddlePaddle/PP-OCRv4_mobile_rec/resolve/main/model.onnx',
  },
]

async function download(url, dest, label, depth = 0) {
  if (depth > 5) throw new Error('Too many redirects')

  return new Promise((resolve, reject) => {
    console.log(`Downloading ${label} ...`)
    console.log(`  URL: ${url}`)

    const file = createWriteStream(dest)
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, { headers: { 'User-Agent': 'Sentinel-Extension/0.2.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        file.close()
        return download(res.headers.location, dest, label, depth + 1).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        file.close()
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }

      const total = parseInt(res.headers['content-length'] || '0', 10)
      let received = 0

      res.on('data', (chunk) => {
        received += chunk.length
        if (total > 0) {
          process.stdout.write(`\r  ${((received / total) * 100).toFixed(1)}% (${(received / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB)`)
        } else {
          process.stdout.write(`\r  ${(received / 1024 / 1024).toFixed(1)} MB received`)
        }
      })

      pipeline(res, file)
        .then(() => { process.stdout.write('\n'); resolve() })
        .catch(reject)
    })

    req.on('error', reject)
  })
}

for (const { url, dest, label, fallbackUrl } of FILES) {
  if (existsSync(dest)) {
    console.log(`Already exists: ${dest}`)
    continue
  }
  try {
    await download(url, dest, label)
  } catch (err) {
    console.warn(`Primary URL failed (${err.message}), trying fallback...`)
    try {
      await download(fallbackUrl, dest, `${label} (fallback)`)
    } catch (err2) {
      console.error(`Failed to download ${label}: ${err2.message}`)
      console.error(`You can download it manually and place it at: ${dest}`)
      continue
    }
  }
  console.log(`Saved: ${dest}`)
}

console.log('\nPP-OCR model assets ready.')
console.log('Run: npm run build:extension  to include them in the extension package.')
