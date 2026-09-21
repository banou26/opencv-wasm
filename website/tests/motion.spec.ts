import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

type Region = {
  x: number
  y: number
  width: number
  height: number
  dx: number | null
  dy: number | null
  totalDx: number | null
  totalDy: number | null
  acceptedFraction: number
}
type Report = {
  width: number
  height: number
  units: string
  vectorMode: string
  dominantTranslation: { dx: number; dy: number } | null
  regions: Region[]
}
const ready = async (page: Page) =>
  expect(page.locator('image-lab')).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
const change = async (page: Page, action: () => Promise<unknown>) => {
  const previous = await page.locator('image-lab').getAttribute('data-result')
  await action()
  await expect(page.locator('image-lab')).not.toHaveAttribute('data-result', previous ?? '')
  await ready(page)
}
const frames = async (page: Page, dx: number, dy: number, movingObject = false, flat = false) => {
  const images = await page.evaluate(
    ({ dx, dy, movingObject, flat }) => {
      const background = document.createElement('canvas'),
        before = document.createElement('canvas'),
        after = document.createElement('canvas')
      for (const canvas of [background, before, after]) {
        canvas.width = 480
        canvas.height = 336
      }
      const ctx = background.getContext('2d')!
      ctx.fillStyle = '#808080'
      ctx.fillRect(0, 0, 480, 336)
      let seed = 1234567
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed / 2 ** 32
      }
      if (!flat)
        for (let y = 0; y < 336; y += 3)
          for (let x = 0; x < 480; x += 3) {
            const shade = Math.floor(40 + random() * 175)
            ctx.fillStyle = `rgb(${shade},${shade},${shade})`
            ctx.fillRect(x, y, 3, 3)
          }
      const a = before.getContext('2d')!,
        b = after.getContext('2d')!
      a.drawImage(background, 0, 0)
      b.fillStyle = '#808080'
      b.fillRect(0, 0, 480, 336)
      b.drawImage(background, dx, dy)
      if (movingObject) {
        const object = document.createElement('canvas')
        object.width = object.height = 144
        const objectContext = object.getContext('2d')!
        for (let y = 0; y < 144; y += 4)
          for (let x = 0; x < 144; x += 4) {
            const shade = Math.floor(45 + random() * 190)
            objectContext.fillStyle = `rgb(${shade},${Math.floor(shade * 0.6)},${Math.floor(shade * 0.3)})`
            objectContext.fillRect(x, y, 4, 4)
          }
        a.drawImage(object, 192, 96)
        b.drawImage(object, 192 + dx + 8, 96 + dy - 4)
      }
      return [before, after].map((canvas) => canvas.toDataURL('image/png').split(',')[1])
    },
    { dx, dy, movingObject, flat }
  )
  for (const [i, name] of ['image', 'second'].entries())
    await page
      .locator(`[name=${name}]`)
      .setInputFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(images[i], 'base64') })
}
const report = async (page: Page): Promise<Report> => {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save vectors JSON', exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('opencv-motion-vectors.json')
  return JSON.parse(await readFile((await file.path())!, 'utf8'))
}
const pin = async (page: Page, x: number, y: number) => {
  await page.locator('[name=pixel-source]').selectOption('1')
  await page.locator('[name=pixel-x]').fill(String(x))
  await page.locator('[name=pixel-x]').press('Tab')
  await page.locator('[name=pixel-y]').fill(String(y))
  await page.locator('[name=pixel-y]').press('Tab')
}

test('regional vectors recover signed pan and stationary image measurements', async ({ page }) => {
  await page.goto('/cookbook/motion-vectors/')
  await page.locator('[name=auto]').uncheck()
  for (const [dx, dy] of [
    [-23, 9],
    [17, -7],
    [0, 0]
  ]) {
    await frames(page, dx, dy)
    await change(page, () => page.locator('.load-runtime').click())
    const data = await report(page)
    expect(data.width).toBe(480)
    expect(data.height).toBe(336)
    expect(data.regions).toHaveLength(70)
    expect(data.units).toContain('processed-image pixels')
    expect(Math.abs(data.dominantTranslation!.dx - dx)).toBeLessThan(0.25)
    expect(Math.abs(data.dominantTranslation!.dy - dy)).toBeLessThan(0.25)
    const interior = data.regions.filter((r) => r.x >= 48 && r.x <= 336 && r.y >= 48 && r.y <= 240)
    expect(interior.every((r) => r.dx !== null && r.dy !== null)).toBe(true)
    for (const r of interior) {
      expect(Math.abs(r.dx! - dx)).toBeLessThan(0.3)
      expect(Math.abs(r.dy! - dy)).toBeLessThan(0.3)
    }
  }
})

test('local motion survives pan subtraction and remains numeric in stages and JSON', async ({ page }) => {
  await page.goto('/cookbook/motion-vectors/')
  await frames(page, -12, 5, true)
  await page.locator('.load-runtime').click()
  await ready(page)
  const total = await report(page),
    object = total.regions.find((r) => r.x === 240 && r.y === 144)!
  expect(Math.abs(total.dominantTranslation!.dx + 12)).toBeLessThan(0.3)
  expect(Math.abs(total.dominantTranslation!.dy - 5)).toBeLessThan(0.3)
  expect(Math.abs(object.dx! + 4)).toBeLessThan(0.5)
  expect(Math.abs(object.dy! - 1)).toBeLessThan(0.5)
  await pin(page, 250, 150)
  await expect(page.locator('.native-values').last()).toContainText('region dx (px)')
  const native = await page.locator('.native-values').last().textContent()
  expect(Math.abs(Number(native!.match(/region dx \(px\): ([\d.-]+)/)![1]) - object.dx!)).toBeLessThan(0.001)
  await page.locator('.lab-stages button').filter({ hasText: 'Dense displacement' }).click()
  await expect(page.locator('.native-values').last()).toContainText('passes checks (1=yes): 1')
  await change(page, () => page.locator('[name=mode]').selectOption('residual'))
  const residual = await report(page),
    local = residual.regions.find((r) => r.x === 240 && r.y === 144)!
  expect(residual.vectorMode).toBe('residual-after-dominant-translation')
  expect(Math.abs(local.dx! - 8)).toBeLessThan(0.5)
  expect(Math.abs(local.dy! + 4)).toBeLessThan(0.5)
  const background = residual.regions.find((r) => r.x === 48 && r.y === 48)!
  expect(Math.hypot(background.dx!, background.dy!)).toBeLessThan(0.3)
  await change(page, () => page.locator('[name=gain]').fill('4'))
  expect((await report(page)).regions).toEqual(residual.regions)
  await change(page, () => page.locator('[name=cell]').fill('24'))
  const smaller = await report(page)
  expect(smaller.regions).toHaveLength(280)
  await page.locator('[name=auto]').uncheck()
  await page.locator('[name=cell]').fill('48')
  await expect(page.locator('.download-data')).toBeHidden()
  await change(page, () => page.locator('.load-runtime').click())
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.locator('.lab-canvases').screenshot({ path: 'test-results/motion-residual.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.locator('.download-data')).toBeEnabled()
})

test('textureless regions are unknown rather than claimed stationary', async ({ page }) => {
  await page.goto('/lab/?algorithm=cookbook-motion-vectors')
  await frames(page, 0, 0, false, true)
  await page.locator('.load-runtime').click()
  await ready(page)
  const data = await report(page)
  expect(data.dominantTranslation).toBeNull()
  expect(data.regions.every((r) => r.dx === null && r.dy === null && r.acceptedFraction === 0)).toBe(true)
  await pin(page, 150, 100)
  await expect(page.locator('.native-values').last()).toContainText('region dx (px): unavailable')
  await expect(page.locator('.result-note')).toContainText('Insufficient texture')
  await change(page, () => page.locator('[name=algorithm]').selectOption('gaussian-blur'))
  await expect(page.locator('.download-data')).toBeHidden()
})
