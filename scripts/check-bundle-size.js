'use strict'

/**
 * CI gate: index main bundle gzip must stay within budget (design §4.4: +50 KB max).
 * Usage: node scripts/check-bundle-size.js [--baseline path] [--max-kb 50]
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const buildDir = path.join(__dirname, '..', 'public', 'build')
const maxIncreaseKb = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--max-kb') || '50', 10)
const baselineArg = process.argv.find((a, i) => process.argv[i - 1] === '--baseline')
const baselinePath = baselineArg || path.join(__dirname, 'bundle-size-baseline.json')

function gzipSize (buf) {
  return zlib.gzipSync(buf).length
}

function findIndexBundle () {
  if (!fs.existsSync(buildDir)) {
    console.error('Build dir missing — run yarn build first:', buildDir)
    process.exit(1)
  }
  const files = fs.readdirSync(buildDir).filter(f => /^index\.[a-f0-9]+\.js$/.test(f))
  if (!files.length) {
    console.error('No index.[hash].js found in', buildDir)
    process.exit(1)
  }
  return path.join(buildDir, files.sort().pop())
}

function main () {
  const indexPath = findIndexBundle()
  const raw = fs.readFileSync(indexPath)
  const gz = gzipSize(raw)
  const name = path.basename(indexPath)

  let baseline = null
  if (fs.existsSync(baselinePath)) {
    try {
      baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
    } catch (e) {
      console.warn('Invalid baseline file, ignoring:', baselinePath)
    }
  }

  const maxBytes = maxIncreaseKb * 1024
  console.log(`index bundle: ${name}`)
  console.log(`  raw:  ${(raw.length / 1024).toFixed(1)} KB`)
  console.log(`  gzip: ${(gz / 1024).toFixed(1)} KB`)

  if (baseline && typeof baseline.indexGzip === 'number') {
    const delta = gz - baseline.indexGzip
    console.log(`  baseline gzip: ${(baseline.indexGzip / 1024).toFixed(1)} KB (delta ${(delta / 1024).toFixed(1)} KB, max +${maxIncreaseKb} KB)`)
    if (delta > maxBytes) {
      console.error(`FAIL: index gzip increased by ${(delta / 1024).toFixed(1)} KB > ${maxIncreaseKb} KB`)
      process.exit(1)
    }
  } else {
    const absoluteMax = 800 * 1024
    console.log(`  no baseline — checking absolute gzip cap ${(absoluteMax / 1024).toFixed(0)} KB`)
    if (gz > absoluteMax) {
      console.error(`FAIL: index gzip ${(gz / 1024).toFixed(1)} KB exceeds cap`)
      process.exit(1)
    }
    fs.writeFileSync(baselinePath, JSON.stringify({ indexGzip: gz, file: name, at: new Date().toISOString() }, null, 2))
    console.log(`  wrote baseline ${baselinePath}`)
  }

  const asyncChunks = fs.readdirSync(buildDir).filter(f =>
    /^(vendor-3d|vendor-chem|vendor-ink|vendor-math-preview|menmen-cards)\.[a-f0-9]+\.js$/.test(f)
  )
  asyncChunks.forEach(f => {
    const sz = gzipSize(fs.readFileSync(path.join(buildDir, f)))
    console.log(`  async ${f}: gzip ${(sz / 1024).toFixed(1)} KB`)
  })

  console.log('OK')
}

main()
