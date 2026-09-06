import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import zlib from 'zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const iconsDir = resolve(__dirname, '..', 'extension', 'icons')

function createMinimalPNG(size) {
  const pixels = Buffer.alloc(size * size * 4)

  const bgR = 10, bgG = 14, bgB = 26, bgA = 255
  const fgR = 134, fgG = 59, fgB = 255, fgA = 255

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4

      const cx = x - size / 2
      const cy = y - size / 2
      const r = size * 0.42

      const corner = size * 0.15
      const inRoundedRect =
        x >= corner && x < size - corner && y >= 0 && y < size ||
        x >= 0 && x < size && y >= corner && y < size - corner ||
        dist(x, y, corner, corner) <= corner ||
        dist(x, y, size - corner, corner) <= corner ||
        dist(x, y, corner, size - corner) <= corner ||
        dist(x, y, size - corner, size - corner) <= corner

      if (!inRoundedRect) {
        pixels[i] = 0; pixels[i+1] = 0; pixels[i+2] = 0; pixels[i+3] = 0
        continue
      }

      const nx = (x / size) * 48
      const ny = (y / size) * 46

      const inBolt = isInBolt(nx, ny)

      if (inBolt) {
        pixels[i] = fgR; pixels[i+1] = fgG; pixels[i+2] = fgB; pixels[i+3] = fgA
      } else {
        pixels[i] = bgR; pixels[i+1] = bgG; pixels[i+2] = bgB; pixels[i+3] = bgA
      }
    }
  }

  return encodePNG(pixels, size, size)
}

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1-x2)**2 + (y1-y2)**2)
}

function isInBolt(x, y) {
  const cx = 24, cy = 23

  const topTriX = [10, 40, 25]
  const topTriY = [0, 0, 20]

  const midTriX = [8, 35, 24]
  const midTriY = [15, 15, 46]

  return pointInTriangle(x, y, topTriX[0], topTriY[0], topTriX[1], topTriY[1], topTriX[2], topTriY[2]) ||
         pointInTriangle(x, y, midTriX[0], midTriY[0], midTriX[1], midTriY[1], midTriX[2], midTriY[2])
}

function pointInTriangle(px, py, x1, y1, x2, y2, x3, y3) {
  const d1 = sign(px, py, x1, y1, x2, y2)
  const d2 = sign(px, py, x2, y2, x3, y3)
  const d3 = sign(px, py, x3, y3, x1, y1)
  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0)
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0)
  return !(hasNeg && hasPos)
}

function sign(px, py, x1, y1, x2, y2) {
  return (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2)
}

function encodePNG(pixels, width, height) {
  const rawData = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0
    for (let x = 0; x < width; x++) {
      const srcI = (y * width + x) * 4
      const dstI = y * (1 + width * 4) + 1 + x * 4
      rawData[dstI]   = pixels[srcI]
      rawData[dstI+1] = pixels[srcI+1]
      rawData[dstI+2] = pixels[srcI+2]
      rawData[dstI+3] = pixels[srcI+3]
    }
  }

  const compressed = zlib.deflateSync(rawData)

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const chunks = [
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]

  return Buffer.concat([signature, ...chunks])
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crcData = Buffer.concat([typeBuffer, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcData) >>> 0, 0)
  return Buffer.concat([len, typeBuffer, data, crc])
}

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return c ^ 0xffffffff
}

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC_TABLE[n] = c
}

for (const size of [16, 48, 128]) {
  const png = createMinimalPNG(size)
  writeFileSync(resolve(iconsDir, `icon-${size}.png`), png)
  console.log(`icon-${size}.png (${png.length} bytes)`)
}

console.log('PNG icons generated in extension/icons/')
