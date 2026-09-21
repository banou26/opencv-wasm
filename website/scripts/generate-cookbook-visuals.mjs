/** Rebuild committed teaching images with the exact native chains used by the lab.
 * Chrome only draws the Canvas samples; all processing/PNG encoding runs in Node WASM.
 * Ordinary docs builds serve these snapshots without loading WASM or requiring Chrome.
 */
import fs from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import ts from 'typescript'

const root = new URL('../../', import.meta.url)
const sourceFiles = [
  'website/scripts/generate-cookbook-visuals.mjs',
  'website/src/data/cookbook.ts',
  'website/src/data/cookbook-visuals.ts',
  'website/src/lib/lab/context.ts',
  'website/src/lib/lab/cookbook.ts',
  'website/src/lib/lab/motion.ts',
  'website/src/lib/lab/sample.ts',
  'website/src/lib/visuals/cookbook-samples.ts'
]
const hash = createHash('sha256')
for (const name of sourceFiles) hash.update(name).update(await fs.readFile(new URL(name, root)))
const sourceHash = hash.digest('hex')
const manifestURL = new URL('website/src/data/cookbook-visuals.generated.json', root)
const publicURL = new URL('website/public/', root)
if (process.argv.includes('--check')) {
  const manifest = JSON.parse(await fs.readFile(manifestURL, 'utf8'))
  if (manifest.sourceHash !== sourceHash)
    throw new Error('Cookbook snapshots are stale. Run npm --prefix website run visuals:cookbook.')
  let frames = 0
  for (const recipe of Object.values(manifest.recipes)) {
    for (const frame of [recipe.input, recipe.second, ...recipe.stages.flat()].filter(Boolean)) {
      const png = await fs.readFile(new URL(frame.src.slice(1), publicURL))
      if (png.readUInt32BE(16) !== frame.width || png.readUInt32BE(20) !== frame.height)
        throw new Error(`Bad snapshot dimensions: ${frame.src}`)
      frames++
    }
  }
  console.log(
    `Verified ${frames} native snapshots across ${Object.keys(manifest.recipes).length} cookbook walkthroughs`
  )
  process.exit(0)
}
// Resolve the website's extensionless TypeScript imports without emitting temporary source files.
const { registerHooks } = await import('node:module')
if (!registerHooks) throw new Error('Generating cookbook snapshots requires Node 22.15 or newer.')
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/website/src/')) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(candidate)) return next(candidate.href, context)
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.startsWith(new URL('website/src/', root).href) && url.endsWith('.ts'))
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
        }).outputText
      }
    return next(url, context)
  }
})
const { cookbook } = await import('../src/data/cookbook.ts')
const { cookbookVisualStages } = await import('../src/data/cookbook-visuals.ts')
const { Experiment } = await import('../src/lib/lab/context.ts')
const { cook } = await import('../src/lib/lab/cookbook.ts')
const runtime = await import('../../lib/index.js')
const { chromium } = await import('@playwright/test')
// The Node image helpers need only this ImageData value container, not a Canvas implementation.
globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) {
    this.data = data
    this.width = width
    this.height = height
  }
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || '/etc/profiles/per-user/banou/bin/google-chrome-stable',
  args: ['--ozone-platform=headless']
})
const manifest = { sourceHash, version: '', recipes: {} }
try {
  const page = await browser.newPage()
  const sample = ts.transpileModule(await fs.readFile(new URL('website/src/lib/lab/sample.ts', root), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
  }).outputText
  await page.addScriptTag({ type: 'module', content: `${sample}\nglobalThis.drawSample = drawSample;` })
  await page.waitForFunction(() => typeof globalThis.drawSample === 'function')
  const samples = new Map()
  for (const kind of ['scene', 'objects', 'document']) {
    samples.set(
      kind,
      await page.evaluate((kind) => {
        const canvas = globalThis.drawSample(kind === 'scene' ? undefined : kind)
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data)
        }
      }, kind)
    )
  }
  const stereoSource = ts.transpileModule(
    await fs.readFile(new URL('website/src/lib/visuals/cookbook-samples.ts', root), 'utf8'),
    {
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
    }
  ).outputText
  await page.addScriptTag({
    type: 'module',
    content: `${stereoSource}\nglobalThis.drawStereoTeachingPair = drawStereoTeachingPair;`
  })
  await page.waitForFunction(() => typeof globalThis.drawStereoTeachingPair === 'function')
  const stereoPair = await page.evaluate(() =>
    globalThis.drawStereoTeachingPair().map((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      pixels: Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data)
    }))
  )
  const cv = await runtime.createOpenCV()
  manifest.version = cv.getVersionString()
  for (const recipe of cookbook) {
    const dir = new URL(`cookbook-visuals/${recipe.id}/`, publicURL)
    await fs.mkdir(dir, { recursive: true })
    const stereo = recipe.id === 'stereo-depth'
    const sample = stereo ? stereoPair[0] : samples.get(recipe.lab.sample ?? 'scene')
    const request = {
      ...sample,
      pixels: new Uint8ClampedArray(sample.pixels),
      id: 0,
      algorithm: `cookbook-${recipe.id}`,
      params: Object.fromEntries(recipe.lab.controls.map((c) => [c.key, c.value])),
      second: stereo ? { ...stereoPair[1], pixels: new Uint8ClampedArray(stereoPair[1].pixels) } : undefined,
      assets: {}
    }
    cv.setRNGSeed(42)
    const experiment = new Experiment(cv, runtime, request)
    try {
      const save = async (frame, filename) => {
        const rgba = runtime.matFromArray(cv, frame.height, frame.width, cv.CV_8UC4, frame.pixels)
        let bgra
        try {
          bgra = new cv.Mat()
          cv.cvtColor(rgba, bgra, cv.COLOR_RGBA2BGRA)
          await fs.writeFile(new URL(`${filename}.png`, dir), runtime.encodeImage(cv, '.png', bgra))
        } finally {
          bgra?.delete()
          rgba.delete()
        }
        return {
          src: `/cookbook-visuals/${recipe.id}/${filename}.png`,
          title: frame.title,
          description: frame.description,
          width: frame.width,
          height: frame.height
        }
      }
      const input = await save(
        {
          ...request,
          title: recipe.lab.second ? 'First frame' : 'Original sample',
          description: stereo
            ? 'Synthetic rectified left view with three textured planes. Their disparities are 8, 16 and 24 px; larger disparity means nearer depth.'
            : 'The unchanged source image. All steps use this same example.'
        },
        'input'
      )
      let second
      if (recipe.lab.second) {
        const image = runtime.toImageData(cv, experiment.second())
        second = await save(
          {
            ...image,
            pixels: image.data,
            title: 'Second frame',
            description: stereo
              ? 'Synthetic right view. The three planes shift left by 8, 16 and 24 px, while staying on the same rows. Occlusion and unmatched borders can produce invalid disparities.'
              : 'Synthetic second view: the scene shifts 12 pixels left with reflected border fill. This is a controlled demonstration, not a real camera capture.'
          },
          'second'
        )
      }
      if (!cook(experiment)) throw new Error(`Unknown recipe: ${recipe.id}`)
      if (stereo) {
        const depths = [90, 200, 340].map((left, index) => {
          const values = []
          for (let y = 40; y < 100; y++)
            for (let x = left; x < left + 30; x++) {
              const value = experiment.native.values[y * sample.width + x]
              if (value > 0) values.push(value)
            }
          values.sort((a, b) => a - b)
          const median = values[Math.floor(values.length / 2)],
            expected = (500 * 0.1) / ((index + 1) * 8)
          if (!Number.isFinite(median) || Math.abs(median - expected) > 0.1)
            throw new Error(`Stereo plane ${index}: expected ${expected}, measured ${median}`)
          return median.toFixed(3)
        })
        experiment.note += ` Synthetic plane depth medians (far to near): ${depths.join(', ')} m with the example calibration. Bright means farther in this normalized depth preview; black is invalid.`
      }
      const final = runtime.toImageData(cv, experiment.out)
      const available = [
        ...experiment.stages,
        {
          ...final,
          pixels: final.data,
          title: 'Result',
          description: experiment.note || 'Final output of the complete chain.'
        }
      ]
      const groups = cookbookVisualStages[recipe.id]
      if (groups?.length !== recipe.steps.length) throw new Error(`Missing visual steps for ${recipe.id}`)
      const stages = []
      for (const [i, group] of groups.entries()) {
        const frames = []
        for (const [j, title] of group.entries()) {
          const frame = available.find((stage) => stage.title === title)
          if (!frame) throw new Error(`Missing native snapshot: ${recipe.id} / ${title}`)
          frames.push(await save(frame, `step-${i + 1}-${j + 1}`))
        }
        stages.push(frames)
      }
      manifest.recipes[recipe.id] = { input, second, stages, note: experiment.note }
      console.log(`${recipe.id}: ${stages.flat().length} native stage snapshots`)
    } catch (error) {
      throw new Error(`${recipe.id}: ${String(error)}`)
    } finally {
      experiment.dispose()
    }
  }
  await fs.writeFile(manifestURL, JSON.stringify(manifest, null, 2) + '\n')
} finally {
  await browser.close()
}
