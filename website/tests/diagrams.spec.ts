import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { algorithms } from '../src/data/algorithms'
import { algorithmVisual } from '../src/lib/visuals'
import { palette } from '../src/lib/visuals/primitives'
import { buildPyramidExample } from '../src/lib/visuals/pyramids'

test('pyramid teaching samples match native filtering and reconstruct signed detail', async () => {
  const { createOpenCV, matFromArray } = await import('../../lib/index.js')
  const cv = await createOpenCV(),
    lesson = buildPyramidExample(),
    original = lesson.gaussian[0]
  const input = matFromArray(cv, original.height, original.width, cv.CV_64FC1, original.pixels)
  const [g1, g2, e1, e2, l0, l1, restored1, restored0, enlargedOnly] = Array.from({ length: 9 }, () => new cv.Mat())
  try {
    cv.pyrDown(input, g1)
    cv.pyrDown(g1, g2)
    cv.pyrUp(g1, e1)
    cv.pyrUp(g2, e2)
    cv.subtract(input, e1, l0)
    cv.subtract(g1, e2, l1)
    cv.add(e2, l1, restored1)
    cv.pyrUp(restored1, restored0)
    cv.add(restored0, l0, restored0)
    cv.pyrUp(e2, enlargedOnly)
    const native = [input, g1, g2, e1, e2, l0, l1, restored0, enlargedOnly]
    const expected = [
      ...lesson.gaussian,
      ...lesson.expanded,
      ...lesson.laplacian,
      lesson.reconstructed,
      lesson.enlargedOnly
    ]
    for (let i = 0; i < native.length; i++) {
      expect([native[i].cols, native[i].rows]).toEqual([expected[i].width, expected[i].height])
      const error = Math.max(...native[i].data64F.map((v, j) => Math.abs(v - expected[i].pixels[j])))
      expect(error, `native agreement for matrix ${i}, including image borders`).toBeLessThan(1e-8)
    }
    expect(lesson.gaussian.map(({ width, height }) => [width, height])).toEqual([
      [32, 24],
      [16, 12],
      [8, 6]
    ])
    for (const band of lesson.laplacian) {
      expect(Math.min(...band.pixels)).toBeLessThan(-1)
      expect(Math.max(...band.pixels)).toBeGreaterThan(1)
    }
    const error = (pixels: number[]) => Math.max(...pixels.map((v, i) => Math.abs(v - original.pixels[i])))
    expect(error(lesson.enlargedOnly.pixels)).toBeGreaterThan(50)
    expect(error(lesson.reconstructed.pixels)).toBeLessThan(1e-8)
  } finally {
    for (const mat of [input, g1, g2, e1, e2, l0, l1, restored1, restored0, enlargedOnly]) mat.delete()
  }
})

test('computed mask and spectrum examples obey their illustrated operations', async ({ page }) => {
  const ids = ['erosion', 'dilation', 'morphology', 'dft', 'quality-metrics']
  await page.setContent(
    ids
      .map((id) => {
        const v = algorithmVisual(algorithms.find((a) => a.id === id)!)
        return `<section data-example="${id}"><div class="input">${v.input.svg}</div>${v.stages.map((stage, i) => `<div data-stage="${i}">${stage.svg}</div>`).join('')}</section>`
      })
      .join('')
  )
  const fills = async (id: string, selector: string) =>
    page
      .locator(`[data-example="${id}"] ${selector} rect`)
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('fill')))
  const input = (await fills('erosion', '.input')).map((fill) => fill === palette.purple)
  const erosion = (await fills('erosion', '[data-stage="2"]')).map((fill) => fill === palette.green)
  const dilation = (await fills('dilation', '[data-stage="2"]')).map((fill) => fill === palette.green)
  const opening = (await fills('morphology', '[data-stage="2"]')).map((fill) => fill === palette.green)
  expect(input).toHaveLength(384)
  expect(erosion.filter(Boolean).length).toBeLessThan(input.filter(Boolean).length)
  expect(dilation.filter(Boolean).length).toBeGreaterThan(input.filter(Boolean).length)
  for (let i = 0; i < input.length; i++) {
    if (erosion[i] || opening[i]) expect(input[i]).toBe(true)
    if (input[i]) expect(dilation[i]).toBe(true)
  }
  // The isolated speck is at (19, 2); a broad interior survives opening.
  expect(input[2 * 24 + 19]).toBe(true)
  expect(opening[2 * 24 + 19]).toBe(false)
  expect(opening[8 * 24 + 7]).toBe(true)
  const peaks = await page
    .locator('[data-example="dft"] [data-stage="1"] rect')
    .evaluateAll((nodes) => nodes.flatMap((node, i) => (Number(node.getAttribute('height')) > 1 ? [i] : [])))
  expect(peaks).toEqual([3, 12])
  await expect(page.locator('[data-example="quality-metrics"] [data-stage="2"]')).toContainText('MSE 492.7')
  await expect(page.locator('[data-example="quality-metrics"] [data-stage="2"]')).toContainText('PSNR 21.20 dB')
})

test('every authored guide has distinct, finite illustration stages', async ({ page }) => {
  const examples = algorithms.map((a) => ({ id: a.id, ...algorithmVisual(a) }))
  for (const example of examples) {
    expect(new Set(example.stages.map((stage) => stage.svg)).size, example.id).toBe(3)
    expect(example.stages[2].svg, example.id).not.toBe(example.input.svg)
    for (const stage of [example.input, ...example.stages]) {
      expect(stage.svg, `${example.id}: ${stage.title}`).not.toMatch(/NaN|Infinity|undefined/)
      expect(stage.detail.length).toBeGreaterThan(20)
    }
  }
  await page.setContent(
    '<style>svg text{font-family:monospace}</style>' +
      examples
        .map(
          (example) =>
            `<section data-example="${example.id}" style="display:flex">${[example.input, ...example.stages].map((stage) => `<div style="width:320px;flex:none">${stage.svg}</div>`).join('')}</section>`
        )
        .join('')
  )
  const clipped = await page.locator('svg text').evaluateAll((nodes) =>
    nodes.flatMap((node) => {
      const text = node as SVGGraphicsElement,
        box = text.getBBox()
      return box.x < -1 || box.x + box.width > 321 || box.y < -1 || box.y + box.height > 225
        ? [{ algorithm: node.closest('[data-example]')!.getAttribute('data-example'), text: node.textContent }]
        : []
    })
  )
  expect(clipped).toEqual([])
})

test('keyboard stages replace rendered images and retain the input', async ({ page }) => {
  for (const id of ['gaussian-blur', 'canny', 'homography', 'kmeans', 'phase-unwrapping', 'nms', 'image-pyramids']) {
    await page.goto(`/algorithms/${id}/`)
    const diagram = page.locator('algorithm-diagram'),
      input = diagram.locator('.diagram-input .diagram-art')
    const initial = await input.innerHTML(),
      hashes: string[] = []
    await diagram.getByRole('button', { name: '1 · Input', exact: true }).click()
    for (let stage = 0; stage < 3; stage++) {
      await expect(diagram.locator('[data-stage-panel]:visible')).toHaveCount(1)
      await expect(diagram.locator(`[data-stage-panel="${stage}"]`)).toBeVisible()
      hashes.push(
        createHash('sha256')
          .update(await diagram.locator('[data-stage-panel]:visible .diagram-art').screenshot())
          .digest('hex')
      )
      expect(await input.innerHTML()).toBe(initial)
      if (stage < 2) await page.keyboard.press('ArrowRight')
    }
    expect(new Set(hashes).size, `${id} must actually change the drawing`).toBe(3)
    await page.keyboard.press('Home')
    await expect(diagram).toHaveAttribute('data-stage', '0')
    await page.keyboard.press('End')
    await expect(diagram).toHaveAttribute('data-stage', '2')
  }
})

test('playback advances, stops and yields to manual selection', async ({ page }) => {
  await page.clock.install()
  await page.goto('/algorithms/homography/')
  const diagram = page.locator('algorithm-diagram')
  await diagram.getByRole('button', { name: 'Play explanation steps' }).click()
  await expect(diagram).toHaveAttribute('data-stage', '0')
  await page.clock.fastForward(3250)
  await expect(diagram).toHaveAttribute('data-stage', '1')
  await diagram.getByRole('button', { name: 'Pause explanation steps' }).click()
  await page.clock.fastForward(4000)
  await expect(diagram).toHaveAttribute('data-stage', '1')
  await diagram.getByRole('button', { name: 'Play explanation steps' }).click()
  await page.clock.fastForward(3250)
  await page.clock.fastForward(3250)
  await expect(diagram).toHaveAttribute('data-stage', '2')
  await page.clock.fastForward(3250)
  await expect(diagram).toHaveAttribute('data-playing', 'false')
  await diagram.getByRole('button', { name: 'Play explanation steps' }).click()
  await diagram.getByRole('button', { name: '3 · Result' }).click()
  await page.clock.fastForward(4000)
  await expect(diagram).toHaveAttribute('data-stage', '2')
  await expect(diagram).toHaveAttribute('data-playing', 'false')
})

test('mobile diagrams stack without clipping and render without JavaScript', async ({ browser, page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/algorithms/canny/')
  const diagram = page.locator('algorithm-diagram')
  await expect(diagram.locator('.diagram-input')).toBeVisible()
  const input = await diagram.locator('.diagram-input').boundingBox(),
    output = await diagram.locator('[data-stage-panel]:visible').boundingBox()
  expect(output!.y).toBeGreaterThan(input!.y + input!.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await diagram.getByRole('button', { name: '2 · Operation' }).click()
  await expect(diagram.locator('[data-stage-panel="1"]')).toBeVisible()
  await diagram.screenshot({ path: 'test-results/diagram-canny-mobile.png' })
  const context = await browser.newContext({ javaScriptEnabled: false })
  const staticPage = await context.newPage()
  await staticPage.goto('/algorithms/gaussian-blur/')
  await expect(staticPage.locator('[data-stage-panel="2"]')).toBeVisible()
  await expect(staticPage.locator('.diagram-input')).toBeVisible()
  await context.close()
})

test('illustration contact sheets for visual review', async ({ page }) => {
  const groups = [
    ['gaussian-blur', 'bilateral-filter', 'canny', 'morphology', 'connected-components', 'clahe'],
    ['homography', 'optical-flow-lk', 'kalman', 'stereo-bm', 'polar-warp', 'nms'],
    ['dft', 'phase-unwrapping', 'kmeans', 'pca', 'dnn-inference', 'quality-metrics'],
    ['watershed', 'superpixels', 'pnp', 'camera-calibration', 'hough-lines', 'inpainting', 'image-pyramids']
  ]
  await page.setViewportSize({ width: 1360, height: 1000 })
  for (let group = 0; group < groups.length; group++) {
    await page.setContent(
      `<style>body{background:#101722;color:#e4e8f0;font:13px system-ui;margin:16px}section{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px}h2{font-size:17px}figure{margin:0}svg{width:100%;background:#131c2b;border:1px solid #293344;border-radius:6px}figcaption{height:30px}svg text{font-family:monospace}</style>` +
        groups[group]
          .map((id) => {
            const a = algorithms.find((a) => a.id === id)!,
              v = algorithmVisual(a)
            return `<h2>${a.title}</h2><section>${[v.input, ...v.stages].map((stage) => `<figure><figcaption>${stage.title}</figcaption>${stage.svg}</figure>`).join('')}</section>`
          })
          .join('')
    )
    await page.screenshot({ path: `test-results/diagrams-sheet-${group + 1}.png`, fullPage: true })
  }
})
