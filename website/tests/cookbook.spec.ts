import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { cookbook } from '../src/data/cookbook'

const ready = async (page: Page) => {
  await expect(page.locator('image-lab')).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
}
const change = async (page: Page, action: () => Promise<unknown>) => {
  const previous = await page.locator('image-lab').getAttribute('data-result')
  await action()
  await expect(page.locator('image-lab')).not.toHaveAttribute('data-result', previous ?? '', { timeout: 45_000 })
  await ready(page)
}
const start = async (page: Page, id: string) => {
  await page.goto(`/cookbook/${id}/`)
  await page.locator('.load-runtime').click()
  await ready(page)
}
const draw = async (page: Page, from: [number, number], to: [number, number]) => {
  await page.locator('canvas.input').scrollIntoViewIfNeeded()
  const box = (await page.locator('canvas.input').boundingBox())!
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 })
  await page.mouse.up()
}
const pairedImages = async (page: Page) => {
  const images = await page.evaluate(() => {
    const before = document.createElement('canvas'),
      after = document.createElement('canvas')
    before.width = after.width = 400
    before.height = after.height = 280
    const ctx = before.getContext('2d')!
    ctx.fillStyle = '#30363f'
    ctx.fillRect(0, 0, 400, 280)
    // A uniquely textured region with a known rigid translation, surrounded by flat pixels.
    for (let y = 40; y < 240; y += 12)
      for (let x = 60; x < 310; x += 12) {
        ctx.fillStyle = `rgb(${(x * 53 + y * 97) % 256},${(x * 19 + y * 31) % 256},${(x * 71 + y * 43) % 256})`
        ctx.fillRect(x, y, 9, 9)
      }
    ctx.fillStyle = 'white'
    ctx.font = 'bold 24px sans-serif'
    ctx.fillText('TRACK THIS', 80, 155)
    const next = after.getContext('2d')!
    next.fillStyle = '#30363f'
    next.fillRect(0, 0, 400, 280)
    next.drawImage(before, 18, 11)
    return [before, after].map((canvas) => canvas.toDataURL('image/png').split(',')[1])
  })
  for (const [i, name] of ['image', 'second'].entries()) {
    await page
      .locator(`[name=${name}]`)
      .setInputFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(images[i], 'base64') })
  }
}

test('all cookbook chains run native WASM and expose inspectable intermediate images', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/lab/?algorithm=cookbook-track-region')
  expect(
    await page.locator('[name=algorithm] option').evaluateAll((nodes) =>
      nodes
        .map((node) => (node as HTMLOptionElement).value)
        .filter((id) => id.startsWith('cookbook-'))
        .sort()
    )
  ).toEqual(cookbook.map((r) => `cookbook-${r.id}`).sort())
  await page.locator('.load-runtime').click()
  await ready(page)
  for (const recipe of cookbook)
    await test.step(recipe.id, async () => {
      await change(page, () => page.locator('[name=algorithm]').selectOption(`cookbook-${recipe.id}`))
      await expect(page.locator('.lab-status')).toContainText('OpenCV 5.0.0')
      await expect(page.locator('.guide-link')).toHaveAttribute('href', `/cookbook/${recipe.id}/`)
      const result = await page.locator('image-lab').getAttribute('data-result')
      const stages = page.locator('.lab-stages button')
      expect(await stages.count()).toBeGreaterThan(1)
      for (const button of await stages.all()) {
        await button.click()
        await expect(button).toHaveAttribute('aria-pressed', 'true')
        expect(
          await page.locator('canvas.output').evaluate((canvas: HTMLCanvasElement) => {
            const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
            return canvas.width > 0 && canvas.height > 0 && data.some((value, i) => i % 4 !== 3 && value > 0)
          })
        ).toBe(true)
        await expect(page.locator('image-lab')).toHaveAttribute('data-result', result!)
      }
      if (recipe.id === 'count-objects') await expect(page.locator('.result-note')).toContainText('6 regions retained')
      if (recipe.id === 'segment-touching')
        await expect(page.locator('.result-note')).toContainText('7 foreground seeds')
      if (recipe.id === 'scan-document') {
        await expect(page.locator('canvas.output')).toHaveAttribute('width', '319')
        await expect(page.locator('canvas.output')).toHaveAttribute('height', '251')
      }
    })
  expect(errors).toEqual([])
})

test('uploaded frame pair and drawn region recover known motion, including zoomed selection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/cookbook/track-region/')
  await pairedImages(page)
  await page.locator('.select-region').click()
  await draw(page, [0.13, 0.12], [0.8, 0.88])
  await page.locator('.load-runtime').click()
  await ready(page)
  const verify = async () => {
    const note = await page.locator('.result-note').textContent()
    const match = note!.match(/Translation dx ([\d.-]+), dy ([\d.-]+)/)!
    expect(Number(match[1])).toBeCloseTo(18, 0)
    expect(Number(match[2])).toBeCloseTo(11, 0)
    await expect(page.locator('canvas.output')).toHaveAttribute('width', '400')
  }
  await verify()
  await page.locator('[name=zoom]').selectOption('2')
  await change(page, () => draw(page, [0.35, 0.3], [0.58, 0.6]))
  expect(Number(await page.locator('.lab-parameters [name=x]').inputValue())).toBeCloseTo(35, 0)
  expect(Number(await page.locator('.lab-parameters [name=width]').inputValue())).toBeCloseTo(23, 0)
  await verify()
  await change(page, () => page.locator('.load-runtime').click())
  await expect(page.locator('.lab-stages button')).toHaveCount(3)
  // A textureless selection reports an actionable failure and never offers stale output for download.
  await page.locator('[name=auto]').uncheck()
  for (const [name, value] of Object.entries({ x: '1', y: '1', width: '5', height: '5' }))
    await page.locator(`.lab-parameters [name=${name}]`).fill(value)
  await page.locator('.load-runtime').click()
  await expect(page.locator('image-lab')).toHaveAttribute('data-state', 'error')
  await expect(page.locator('.lab-status')).toContainText('textured region')
  await expect(page.locator('.download')).toBeDisabled()
  await expect(page.locator('.lab-stages button')).toHaveCount(0)
  await page.locator('[name=zoom]').selectOption('fit')
  await draw(page, [0.13, 0.12], [0.8, 0.88])
  await change(page, () => page.locator('.load-runtime').click())
  await verify()
})

test('template localization and alignment agree with uploaded image geometry', async ({ page }) => {
  await page.goto('/lab/?algorithm=cookbook-locate-template')
  await pairedImages(page)
  for (const [name, value] of Object.entries({ x: '20', y: '20', width: '25', height: '40' }))
    await page.locator(`.lab-parameters [name=${name}]`).fill(value)
  await page.locator('.load-runtime').click()
  await ready(page)
  await expect(page.locator('.result-note')).toContainText('at (98, 67). Match accepted.')
  await page.locator('[name=auto]').uncheck()
  for (const [name, value] of Object.entries({ x: '1', y: '1', width: '5', height: '5' }))
    await page.locator(`.lab-parameters [name=${name}]`).fill(value)
  await page.locator('.load-runtime').click()
  await expect(page.locator('image-lab')).toHaveAttribute('data-state', 'error')
  await expect(page.locator('.lab-status')).toContainText('visible texture')
  await page.locator('[name=algorithm]').selectOption('cookbook-align-images')
  await change(page, () => page.locator('[name=auto]').check())
  const alignedError = await page.evaluate(() => {
    const a = document.querySelector<HTMLCanvasElement>('canvas.input')!,
      b = document.querySelector<HTMLCanvasElement>('canvas.output')!
    const left = a.getContext('2d')!.getImageData(30, 25, 330, 230).data,
      right = b.getContext('2d')!.getImageData(30, 25, 330, 230).data
    return left.reduce((sum, value, i) => sum + Math.abs(value - right[i]), 0) / left.length
  })
  expect(alignedError).toBeLessThan(6)
  await page.locator('[name=inspect-input]').selectOption('second')
  const unalignedError = await page.evaluate(() => {
    const a = document.querySelector<HTMLCanvasElement>('canvas.input')!,
      b = document.querySelector<HTMLCanvasElement>('canvas.output')!
    const left = a.getContext('2d')!.getImageData(30, 25, 330, 230).data,
      right = b.getContext('2d')!.getImageData(30, 25, 330, 230).data
    return left.reduce((sum, value, i) => sum + Math.abs(value - right[i]), 0) / left.length
  })
  expect(unalignedError).toBeGreaterThan(alignedError * 3)
})

test('masked blur preserves unselected pixels and cutout downloads retain alpha', async ({ page }) => {
  await start(page, 'blur-region')
  const differences = await page.evaluate(() => {
    const a = document.querySelector<HTMLCanvasElement>('canvas.input')!,
      b = document.querySelector<HTMLCanvasElement>('canvas.output')!
    const before = a.getContext('2d')!.getImageData(0, 0, a.width, a.height).data,
      after = b.getContext('2d')!.getImageData(0, 0, b.width, b.height).data
    const param = (name: string) =>
      Number(document.querySelector<HTMLInputElement>(`.lab-parameters [name=${name}]`)!.value)
    const x0 = Math.floor((a.width * param('x')) / 100),
      y0 = Math.floor((a.height * param('y')) / 100),
      x1 = x0 + Math.floor((a.width * param('width')) / 100),
      y1 = y0 + Math.floor((a.height * param('height')) / 100)
    let inside = 0,
      outside = 0
    for (let y = 0; y < a.height; y++)
      for (let x = 0; x < a.width; x++)
        for (let c = 0; c < 3; c++) {
          const i = (y * a.width + x) * 4 + c
          if (before[i] !== after[i]) {
            if (x >= x0 && x < x1 && y >= y0 && y < y1) inside++
            else outside++
          }
        }
    return { inside, outside }
  })
  expect(differences.outside).toBe(0)
  expect(differences.inside).toBeGreaterThan(100)
  await page.locator('[name=auto]').uncheck()
  for (const [name, value] of Object.entries({ x: '0', y: '0', width: '100', height: '100' }))
    await page.locator(`.lab-parameters [name=${name}]`).fill(value)
  await change(page, () => page.locator('.load-runtime').click())
  await page.locator('.lab-stages button').first().click()
  expect(
    await page.locator('canvas.output').evaluate((canvas: HTMLCanvasElement) =>
      canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.every((value) => value === 255)
    )
  ).toBe(true)
  await start(page, 'remove-background')
  const download = page.waitForEvent('download')
  await page.locator('.download').click()
  const file = await download
  expect(file.suggestedFilename()).toContain('cookbook-remove-background')
  const bytes = await readFile((await file.path())!)
  const alpha = await page.evaluate(async (values) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(values)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    image.close()
    const valuesAlpha = ctx.getImageData(0, 0, canvas.width, canvas.height).data.filter((_, i) => i % 4 === 3)
    return {
      opaque: valuesAlpha.includes(255),
      clear: valuesAlpha.includes(0),
      soft: valuesAlpha.some((v) => v > 0 && v < 255)
    }
  }, Array.from(bytes))
  expect(alpha).toEqual({ opaque: true, clear: true, soft: true })
})

test('cookbook navigation, filters, mobile selection and removed guide work', async ({ page, request }) => {
  expect((await request.get('/guides/cadence/')).status()).toBe(404)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/cookbook/')
  await expect(page.locator('.atlas-card')).toHaveCount(cookbook.length)
  await page.getByRole('searchbox', { name: 'Find a recipe or a use case' }).fill('tracking')
  await expect(page.locator('.atlas-card:visible')).toHaveCount(1)
  await page.locator('.atlas-card:visible').click()
  await expect(page.locator('image-lab')).toHaveAttribute('data-algorithm', 'cookbook-track-region')
  await expect(page.locator('#starlight__sidebar a[href="/guides/cadence/"]')).toHaveCount(0)
  await page.getByRole('button', { name: /Menu/ }).click()
  await expect(page.locator('#starlight__sidebar a[aria-current=page]')).toHaveText('Track a selected region')
  await page.getByRole('button', { name: /Menu/ }).click()
  await page.locator('.select-region').click()
  await draw(page, [0.15, 0.1], [0.55, 0.82])
  await page.locator('.load-runtime').click()
  await ready(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/cookbook-tracking-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.screenshot({ path: 'test-results/cookbook-tracking-desktop.png', fullPage: true })
})

test('undersized paired uploads report validation and retain usable input', async ({ page }) => {
  await page.goto('/cookbook/track-region/')
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 20
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page
    .locator('[name=image]')
    .setInputFiles({ name: 'small.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.locator('.lab-status')).toContainText('at least 32 × 32')
  await expect(page.locator('canvas.input')).toHaveAttribute('width', '448')
  await expect(page.locator('.download')).toBeDisabled()
  await page.locator('.reset-image').click()
  await page.locator('.load-runtime').click()
  await ready(page)
})
