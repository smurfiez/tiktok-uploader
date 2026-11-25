import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'assets', 'icon.svg')
const buildDir = join(root, 'packages', 'desktop', 'build')
const docsDir = join(root, 'docs')

const ICONSET_ENTRIES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

const ICO_SIZES = [16, 32, 48, 64, 128, 256]

function findBrowser() {
  const explicit = process.env.CHROME_PATH?.trim()
  if (explicit && existsSync(explicit)) return { executablePath: explicit }

  const macCandidates = [
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ]
  const found = macCandidates.find((p) => existsSync(p))
  if (found) return { executablePath: found }

  return { channel: 'chrome' }
}

async function renderSvgToPng(svgSource, outPath, size = 1024) {
  const launchOpts = findBrowser()
  const browser = await chromium.launch({ ...launchOpts, headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1
    })
    await page.setContent(`<!doctype html>
<html>
<head>
<style>
  html, body { margin: 0; padding: 0; width: ${size}px; height: ${size}px; background: transparent; overflow: hidden; }
  svg { display: block; width: ${size}px; height: ${size}px; }
</style>
</head>
<body>${svgSource}</body>
</html>`)
    await page.screenshot({ path: outPath, omitBackground: true })
  } finally {
    await browser.close()
  }
}

function sipsResize(src, dest, size) {
  execFileSync('sips', ['-z', String(size), String(size), src, '--out', dest], { stdio: 'ignore' })
}

function buildIcns(srcPng, outIcns) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'tiktok-iconset-'))
  const iconsetDir = join(tempRoot, 'icon.iconset')
  mkdirSync(iconsetDir, { recursive: true })
  try {
    for (const [name, size] of ICONSET_ENTRIES) {
      const target = join(iconsetDir, name)
      if (size === 1024) copyFileSync(srcPng, target)
      else sipsResize(srcPng, target, size)
    }
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', outIcns], { stdio: 'inherit' })
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

function buildIco(srcPng, outIco) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'tiktok-ico-'))
  try {
    const images = ICO_SIZES.map((size) => {
      const pngFile = join(tempRoot, `${size}.png`)
      sipsResize(srcPng, pngFile, size)
      return { size, data: readFileSync(pngFile) }
    })

    const headerSize = 6
    const entrySize = 16
    let offset = headerSize + entrySize * images.length

    const header = Buffer.alloc(headerSize)
    header.writeUInt16LE(0, 0)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(images.length, 4)

    const entries = []
    for (const { size, data } of images) {
      const entry = Buffer.alloc(entrySize)
      const dim = size >= 256 ? 0 : size
      entry.writeUInt8(dim, 0)
      entry.writeUInt8(dim, 1)
      entry.writeUInt8(0, 2)
      entry.writeUInt8(0, 3)
      entry.writeUInt16LE(1, 4)
      entry.writeUInt16LE(32, 6)
      entry.writeUInt32LE(data.length, 8)
      entry.writeUInt32LE(offset, 12)
      entries.push(entry)
      offset += data.length
    }

    writeFileSync(outIco, Buffer.concat([header, ...entries, ...images.map((img) => img.data)]))
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

async function main() {
  mkdirSync(buildDir, { recursive: true })
  mkdirSync(docsDir, { recursive: true })

  const svgSource = readFileSync(svgPath, 'utf8')
  const masterPng = join(buildDir, 'icon.png')
  await renderSvgToPng(svgSource, masterPng, 1024)

  buildIcns(masterPng, join(buildDir, 'icon.icns'))
  buildIco(masterPng, join(buildDir, 'icon.ico'))

  copyFileSync(svgPath, join(docsDir, 'icon.svg'))
  sipsResize(masterPng, join(docsDir, 'favicon-32.png'), 32)
  sipsResize(masterPng, join(docsDir, 'apple-touch-icon.png'), 180)

  console.log('Generated icons in packages/desktop/build/ and docs/')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
