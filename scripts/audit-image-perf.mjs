/**
 * One-shot production image/static delivery audit.
 * Usage: node scripts/audit-image-perf.mjs [baseUrl]
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const base = process.argv[2] || 'https://azarov-giftbot-production.up.railway.app'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function measure(urlPath) {
  const url = urlPath.startsWith('http') ? urlPath : base + urlPath
  const t0 = performance.now()
  const res = await fetch(url, { headers: { 'Accept-Encoding': 'br, gzip' } })
  const ttfb = performance.now() - t0
  const buf = Buffer.from(await res.arrayBuffer())
  const total = performance.now() - t0
  return {
    path: urlPath,
    status: res.status,
    ttfb: Math.round(ttfb),
    download: Math.round(total - ttfb),
    total: Math.round(total),
    decodedBytes: buf.length,
    enc: res.headers.get('content-encoding') || '(none)',
    cache: res.headers.get('cache-control') || '-',
    type: (res.headers.get('content-type') || '-').split(';')[0],
    cl: res.headers.get('content-length'),
    buf,
  }
}

function fmt(r) {
  const kb = (r.decodedBytes / 1024).toFixed(1).padStart(7)
  return `${String(r.path).padEnd(44)} TTFB=${String(r.ttfb).padStart(5)}ms  dl=${String(r.download).padStart(5)}ms  total=${String(r.total).padStart(5)}ms  body=${kb}KB  enc=${r.enc.padEnd(8)} cache=${r.cache}  type=${r.type}`
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

console.log('=== LOCAL ASSET INVENTORY ===')
const localFiles = [...walk(path.join(root, 'src/assets')), ...walk(path.join(root, 'public'))].filter((f) =>
  /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(f),
)

const localRows = []
for (const abs of localFiles) {
  const rel = path.relative(root, abs)
  const buf = fs.readFileSync(abs)
  const ext = path.extname(abs).toLowerCase()
  let w = '-', h = '-', fmtName = ext.slice(1), alpha = '-'
  if (ext !== '.svg') {
    try {
      const meta = await sharp(buf, { failOn: 'none' }).metadata()
      w = meta.width
      h = meta.height
      fmtName = meta.format
      alpha = meta.hasAlpha ? 'yes' : 'no'
    } catch {
      /* ignore */
    }
  }
  localRows.push({
    rel,
    kb: +(buf.length / 1024).toFixed(1),
    w,
    h,
    fmt: fmtName,
    alpha,
    hash: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12),
  })
}
localRows.sort((a, b) => b.kb - a.kb)
console.log('file | KB | dims | format | alpha | hash')
for (const r of localRows) {
  console.log(`${r.rel} | ${r.kb} | ${r.w}x${r.h} | ${r.fmt} | ${r.alpha} | ${r.hash}`)
}
const byHash = new Map()
for (const r of localRows) {
  if (!byHash.has(r.hash)) byHash.set(r.hash, [])
  byHash.get(r.hash).push(r.rel)
}
const dups = [...byHash.entries()].filter(([, list]) => list.length > 1)
console.log('\nDuplicate content:', dups.length ? dups : 'none')

console.log('\n=== PRODUCTION NETWORK ===')
const html = await measure('/')
console.log(fmt(html))
const text = html.buf.toString('utf8')
const jsPath = (text.match(/src="(\/assets\/[^"]+\.js)"/) || [])[1]
const cssPath = (text.match(/href="(\/assets\/[^"]+\.css)"/) || [])[1]
if (!jsPath) {
  console.log('FAILED to parse JS from HTML. Snippet:\n', text.slice(0, 400))
  process.exit(1)
}
console.log('js=', jsPath, 'css=', cssPath)

const jsR = await measure(jsPath)
const cssR = await measure(cssPath)
const splash = await measure('/splash-azarov.webp')
const splashGif = await measure('/splash-azarov.gif')
const popup = await measure('/welvura-popup.webp')
console.log(fmt(jsR))
console.log(fmt(cssR))
console.log(fmt(splash))
console.log(fmt(splashGif))
console.log(fmt(popup))

const jsText = jsR.buf.toString('utf8')
const imgSet = new Set()
for (const m of jsText.matchAll(/\/assets\/[A-Za-z0-9._-]+\.(?:webp|png|gif|jpe?g|svg)/g)) {
  imgSet.add(m[0])
}
const imgs = [...imgSet].sort()
console.log(`\nUnique image URLs in main JS: ${imgs.length}`)
imgs.forEach((u) => console.log(' ', u))

console.log('\n=== IMAGE TIMINGS (first 25) ===')
const imageResults = []
for (const u of imgs.slice(0, 25)) {
  const r = await measure(u)
  imageResults.push(r)
  console.log(fmt(r))
}

console.log('\n=== WARM REPEAT x3 (first image) ===')
const sample = imgs[0] || '/splash-azarov.gif'
for (let i = 0; i < 3; i++) console.log(fmt(await measure(sample)))

const sample5 = imgs.slice(0, 5)
if (sample5.length) {
  console.log('\n=== SEQUENTIAL 5 ===')
  const t0 = performance.now()
  for (const u of sample5) console.log(fmt(await measure(u)))
  console.log('SEQ wall', Math.round(performance.now() - t0), 'ms')

  console.log('\n=== PARALLEL 5 ===')
  const t1 = performance.now()
  const results = await Promise.all(sample5.map((u) => measure(u)))
  results.forEach((r) => console.log(fmt(r)))
  console.log('PAR wall', Math.round(performance.now() - t1), 'ms')
}

const chunks = [...new Set([...jsText.matchAll(/assets\/[^"'\\]+\.js/g)].map((m) => m[0]))]
console.log('\nJS chunk refs in main bundle:', chunks.length)
chunks.slice(0, 20).forEach((c) => console.log(' ', c))

console.log('\n=== SUMMARY ===')
const avgTtfb =
  imageResults.length === 0
    ? 0
    : Math.round(imageResults.reduce((s, r) => s + r.ttfb, 0) / imageResults.length)
const avgDl =
  imageResults.length === 0
    ? 0
    : Math.round(imageResults.reduce((s, r) => s + r.download, 0) / imageResults.length)
console.log({
  htmlTtfb: html.ttfb,
  jsDecodedKB: +(jsR.decodedBytes / 1024).toFixed(1),
  jsEnc: jsR.enc,
  cssDecodedKB: +(cssR.decodedBytes / 1024).toFixed(1),
  splashKB: +(splash.decodedBytes / 1024).toFixed(1),
  splashTtfb: splash.ttfb,
  splashDl: splash.download,
  imagesInMainJs: imgs.length,
  avgImageTtfb: avgTtfb,
  avgImageDownload: avgDl,
})
