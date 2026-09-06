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

console.log('Extension build complete: dist-extension/')
console.log('Load it in Chrome via chrome://extensions → Load unpacked → select dist-extension/')
