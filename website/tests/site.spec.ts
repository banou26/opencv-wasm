import { test, expect } from '@playwright/test'

test('atlas filters, keyboard stages and exact API links work', async ({ page }) => {
  await page.goto('/algorithms/')
  await page.getByRole('searchbox', { name: 'Find an algorithm or a use case' }).fill('homography')
  await page.getByRole('link', { name: /Homography and RANSAC/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Homography and RANSAC')
  const diagram = page.locator('algorithm-diagram').first()
  await diagram.getByRole('button', { name: '1 · Input' }).focus()
  await page.keyboard.press('Enter')
  await expect(diagram).toHaveAttribute('data-stage', '0')
  await expect(diagram.locator('.diagram-caption')).toContainText('Propose a homography')
  await page.locator('.reference-list a').filter({ hasText: /^findHomographyReference/ }).count().then(async count => {
    if (count) await page.locator('.reference-list a').filter({ hasText: /^findHomographyReference/ }).click()
    else await page.locator('a[href="/api/findHomography/"]').last().click()
  })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('cv.findHomography')
  await expect(page.locator('.parameters')).toContainText('srcPoints')
  await expect(page.locator('a[href*="github.com/opencv/opencv/blob/5.0.0/"]').first()).toBeVisible()
})

test('reference search includes classes without public constructors and their inherited types', async ({ page }) => {
  await page.goto('/api/')
  await page.getByRole('searchbox', { name: 'Find a function, class, or type' }).fill('CLAHE')
  await page.locator('.reference-list a[href="/api/CLAHE/"]').click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('cv.CLAHE')
  await expect(page.getByRole('heading', { name: 'apply', exact: true })).toBeVisible()
  await expect(page.locator('.callout').first()).toContainText('Native object')
})

test('global full-text search finds a generated API page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Search/ }).first().click()
  const search = page.locator('dialog .pagefind-ui__search-input')
  await search.fill('GaussianBlur')
  await expect(page.locator('dialog .pagefind-ui__result-link').first()).toBeVisible()
  await expect(page.locator('dialog')).toContainText('GaussianBlur')
  await page.keyboard.press('Escape')
})

test('all ten image lab algorithms execute real WASM, update pixels and allow download', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/lab/')
  await page.getByRole('button', { name: 'Load OpenCV and run' }).click()
  await expect(page.locator('image-lab')).toHaveAttribute('data-result', '1', { timeout: 45_000 })
  await expect(page.locator('.lab-status')).toContainText('OpenCV 5.0.0')
  const ids = await page.locator('select[name=algorithm] option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value))
  const results: number[] = []
  for (const id of ids) {
    const previous = await page.locator('image-lab').getAttribute('data-result')
    await page.locator('select[name=algorithm]').selectOption(id)
    await expect(page.locator('image-lab')).not.toHaveAttribute('data-result', previous!)
    await expect(page.locator('.lab-status')).not.toContainText('could not')
    const stats = await page.locator('canvas.output').evaluate((node: HTMLCanvasElement) => {
      const pixels = node.getContext('2d')!.getImageData(0, 0, node.width, node.height).data
      let min = 255, max = 0, hash = 2166136261
      for (let i = 0; i < pixels.length; i += 4) { min = Math.min(min, pixels[i]); max = Math.max(max, pixels[i]); hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0 }
      return { min, max, hash }
    })
    expect(stats.max, id).toBeGreaterThan(stats.min)
    results.push(stats.hash)
  }
  expect(new Set(results).size).toBe(ids.length)
  const previous = await page.locator('image-lab').getAttribute('data-result')
  await page.locator('input[type=range]').fill('85')
  await expect(page.locator('image-lab')).not.toHaveAttribute('data-result', previous!)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save PNG' }).click()
  expect((await downloaded).suggestedFilename()).toBe('opencv-clahe.png')
  const png = await page.locator('canvas.input').evaluate((node: HTMLCanvasElement) => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400
    canvas.getContext('2d')!.drawImage(node, 0, 0, 800, 400)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.locator('canvas.output')).toHaveAttribute('width', '640')
  await expect(page.locator('canvas.output')).toHaveAttribute('height', '320')
  await page.getByRole('button', { name: 'Reset image' }).click()
  await expect(page.locator('canvas.output')).toHaveAttribute('width', '448')
  await expect(page.getByRole('button', { name: 'Save PNG' })).toBeEnabled()
  expect(errors).toEqual([])
})

test('mobile layout, theme and navigation remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/algorithms/homography/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: /Menu/ }).click()
  await page.locator('#starlight__sidebar starlight-theme-select select').selectOption('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.locator('#starlight__sidebar a[href="/lab/"]').click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Image laboratory')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('desktop and mobile visual review artifacts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.goto('/')
  await page.evaluate(() => { localStorage.setItem('starlight-theme', 'dark'); document.documentElement.dataset.theme = 'dark' })
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true })
  await page.goto('/algorithms/homography/')
  await page.screenshot({ path: 'test-results/homography-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/homography-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.goto('/lab/')
  await page.getByRole('button', { name: 'Load OpenCV and run' }).click()
  await expect(page.locator('image-lab')).toHaveAttribute('data-result', '1', { timeout: 45_000 })
  await page.screenshot({ path: 'test-results/lab-desktop.png', fullPage: true })
})
