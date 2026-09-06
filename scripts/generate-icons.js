import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const iconsDir = resolve(__dirname, '..', 'extension', 'icons')

function createPNG(size) {
  const canvas = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${Math.round(size * 0.15)}" fill="#0a0e1a"/>
    <g transform="translate(${size * 0.15}, ${size * 0.12}) scale(${(size * 0.7) / 48})">
      <path fill="#863bff" d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"/>
    </g>
  </svg>`
  return canvas
}

for (const size of [16, 48, 128]) {
  writeFileSync(resolve(iconsDir, `icon-${size}.svg`), createPNG(size))
}

console.log('SVG icons written to extension/icons/')
console.log('Note: Chrome accepts SVG icons. For PNG, convert using an image tool.')
