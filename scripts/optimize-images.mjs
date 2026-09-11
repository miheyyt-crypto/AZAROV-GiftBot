/**
 * One-shot / repeatable asset optimizer for Mini App images.
 * Converts heavy PNG/JPG to WebP at display-appropriate max edge.
 *
 * Usage: node scripts/optimize-images.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** @type {{ src: string, out: string, maxEdge: number, quality: number }[]} */
const jobs = [
  { src: 'public/welvura-popup.png', out: 'public/welvura-popup.webp', maxEdge: 768, quality: 82 },

  { src: 'src/assets/cases/referral.webp', out: 'src/assets/cases/referral.webp', maxEdge: 480, quality: 82 },
  { src: 'src/assets/cases/poor.webp', out: 'src/assets/cases/poor.webp', maxEdge: 480, quality: 82 },
  { src: 'src/assets/cases/medium.webp', out: 'src/assets/cases/medium.webp', maxEdge: 480, quality: 82 },
  { src: 'src/assets/cases/rich.webp', out: 'src/assets/cases/rich.webp', maxEdge: 480, quality: 82 },
  { src: 'src/assets/cases/reward-coins.webp', out: 'src/assets/cases/reward-coins.webp', maxEdge: 256, quality: 85 },
  { src: 'src/assets/cases/reward-rub-1000.webp', out: 'src/assets/cases/reward-rub-1000.webp', maxEdge: 512, quality: 82 },
  { src: 'src/assets/cases/reward-rub-5000.webp', out: 'src/assets/cases/reward-rub-5000.webp', maxEdge: 512, quality: 82 },
  { src: 'src/assets/cases/reward-rub-other.webp', out: 'src/assets/cases/reward-rub-other.webp', maxEdge: 512, quality: 82 },
  { src: 'src/assets/cases/reward-loot-bag.webp', out: 'src/assets/cases/reward-loot-bag.webp', maxEdge: 256, quality: 82 },
  { src: 'src/assets/cases/reward-swiss-watch.webp', out: 'src/assets/cases/reward-swiss-watch.webp', maxEdge: 256, quality: 82 },
  { src: 'src/assets/cases/reward-diamond-ring.webp', out: 'src/assets/cases/reward-diamond-ring.webp', maxEdge: 256, quality: 82 },
  { src: 'src/assets/cases/reward-durov-glass.webp', out: 'src/assets/cases/reward-durov-glass.webp', maxEdge: 256, quality: 82 },
  { src: 'src/assets/cases/reward-gram.webp', out: 'src/assets/cases/reward-gram.webp', maxEdge: 256, quality: 82 },

  { src: 'src/assets/shop/cash.png', out: 'src/assets/shop/cash.webp', maxEdge: 640, quality: 82 },
  { src: 'src/assets/shop/freeze.png', out: 'src/assets/shop/freeze.webp', maxEdge: 640, quality: 82 },
  { src: 'src/assets/shop/welvura-200.png', out: 'src/assets/shop/welvura-200.webp', maxEdge: 640, quality: 82 },
  { src: 'src/assets/shop/welvura-500.png', out: 'src/assets/shop/welvura-500.webp', maxEdge: 640, quality: 82 },
  { src: 'src/assets/shop/premium-12m.png', out: 'src/assets/shop/premium-12m.webp', maxEdge: 512, quality: 82 },
  { src: 'src/assets/shop/premium-6m.png', out: 'src/assets/shop/premium-6m.webp', maxEdge: 512, quality: 82 },
  { src: 'src/assets/shop/donate.png', out: 'src/assets/shop/donate.webp', maxEdge: 512, quality: 82 },
  { src: 'src/assets/shop/music.png', out: 'src/assets/shop/music.webp', maxEdge: 512, quality: 82 },
  { src: 'src/assets/shop/vip.png', out: 'src/assets/shop/vip.webp', maxEdge: 512, quality: 82 },

  { src: 'src/assets/partners/welvura-cookie.png', out: 'src/assets/partners/welvura-cookie.webp', maxEdge: 512, quality: 82 },
  { src: 'src/assets/partners/stake-logo.png', out: 'src/assets/partners/stake-logo.webp', maxEdge: 640, quality: 82 },

  { src: 'src/assets/banners/banner-friends.png', out: 'src/assets/banners/banner-friends.webp', maxEdge: 800, quality: 80 },
  { src: 'src/assets/banners/banner-shop.png', out: 'src/assets/banners/banner-shop.webp', maxEdge: 800, quality: 80 },
  { src: 'src/assets/banners/banner-tasks.png', out: 'src/assets/banners/banner-tasks.webp', maxEdge: 800, quality: 80 },
  { src: 'src/assets/banners/mines-banner.jpg', out: 'src/assets/banners/mines-banner.webp', maxEdge: 640, quality: 80 },
  { src: 'src/assets/banners/tower-banner.png', out: 'src/assets/banners/tower-banner.webp', maxEdge: 640, quality: 80 },
]

async function optimizeOne(job) {
  const inputPath = path.join(root, job.src)
  const outputPath = path.join(root, job.out)
  if (!fs.existsSync(inputPath)) {
    console.warn('skip missing', job.src)
    return null
  }

  const before = fs.statSync(inputPath).size
  const tmpPath = outputPath + '.tmp.webp'
  const image = sharp(inputPath, { failOn: 'none' })
  const meta = await image.metadata()
  const width = meta.width || job.maxEdge
  const height = meta.height || job.maxEdge
  const longest = Math.max(width, height)
  const pipeline =
    longest > job.maxEdge
      ? image.resize({
          width: width >= height ? job.maxEdge : undefined,
          height: height > width ? job.maxEdge : undefined,
          fit: 'inside',
          withoutEnlargement: true,
        })
      : image

  await pipeline.webp({ quality: job.quality, effort: 6 }).toFile(tmpPath)
  const after = fs.statSync(tmpPath).size

  // Prefer smaller result; if somehow larger, keep previous output / source.
  if (after >= before && outputPath === inputPath) {
    fs.unlinkSync(tmpPath)
    return { src: job.src, out: job.out, before, after: before, skipped: true }
  }

  // Windows often blocks rename over an existing file — copy then remove.
  fs.copyFileSync(tmpPath, outputPath)
  fs.unlinkSync(tmpPath)
  return {
    src: job.src,
    out: job.out,
    before,
    after,
    dims: `${width}x${height}`,
    maxEdge: job.maxEdge,
  }
}

const results = []
for (const job of jobs) {
  results.push(await optimizeOne(job))
}

let saved = 0
for (const r of results.filter(Boolean)) {
  if (r.skipped) {
    console.log(`keep  ${r.src} (${(r.before / 1024).toFixed(0)} KB)`)
    continue
  }
  const delta = r.before - r.after
  saved += Math.max(0, delta)
  console.log(
    `${(r.before / 1024).toFixed(0).padStart(5)} → ${(r.after / 1024).toFixed(0).padStart(4)} KB  ${r.src} → ${r.out} (${r.dims} ≤${r.maxEdge})`,
  )
}

console.log(`\nSaved ≈ ${(saved / 1024 / 1024).toFixed(2)} MB (vs source bytes for converted files)`)
