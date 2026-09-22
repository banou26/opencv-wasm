import { test, expect } from '@playwright/test'
import { readFile, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

test('WASM chunks reconstruct the native binary and every Pages asset fits', async () => {
  const manifest = JSON.parse(await readFile('src/data/wasm.generated.json', 'utf8')) as {
    byteLength: number; sha256: string; chunks: { url: string; byteLength: number }[]
  }
  const chunks = await Promise.all(manifest.chunks.map(async chunk => {
    const bytes = await readFile(path.join('public', chunk.url))
    expect(bytes.byteLength).toBe(chunk.byteLength)
    expect(bytes.byteLength).toBeLessThanOrEqual(16 * 1024 * 1024)
    return bytes
  }))
  expect(chunks.length).toBeGreaterThan(1)
  const binary = Buffer.concat(chunks)
  expect(binary.byteLength).toBe(manifest.byteLength)
  expect(createHash('sha256').update(binary).digest('hex')).toBe(manifest.sha256)
  expect(binary.equals(await readFile('../lib/opencv_js.wasm'))).toBe(true)
  await expect(stat('public/runtime/opencv_js.wasm')).rejects.toMatchObject({ code: 'ENOENT' })
  for (const file of await readdir('dist', { recursive: true })) {
    const entry = await stat(path.join('dist', file))
    if (entry.isFile()) expect(entry.size, file).toBeLessThanOrEqual(25 * 1024 * 1024)
  }
})

test('the browser loads chunks lazily and runs the complete native engine', async ({ page, context }) => {
  const manifest = JSON.parse(await readFile('src/data/wasm.generated.json', 'utf8'))
  const requests: string[] = []
  context.on('request', request => requests.push(request.url()))
  await page.goto('/algorithms/gaussian-blur/')
  expect(requests.filter(url => url.includes('/runtime/'))).toEqual([])
  await page.locator('.load-runtime').click()
  await expect(page.locator('image-lab')).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
  await expect(page.locator('.lab-status')).toContainText('OpenCV 5.0.0')
  expect(requests.filter(url => /\/runtime\/opencv-.*\.bin$/.test(url))).toHaveLength(manifest.chunks.length)
  expect(requests.filter(url => url.endsWith('.wasm'))).toEqual([])
  const pixels = await page.locator('canvas.output').evaluate((canvas: HTMLCanvasElement) =>
    canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, i) => i % 4 !== 3 && value > 0))
  expect(pixels).toBe(true)
})

for (const failure of ['missing', 'corrupt'] as const) {
  test(`a ${failure} chunk reports an error and a subsequent run recovers`, async ({ page, context }) => {
    const match = '**/runtime/opencv-*-0.bin'
    await context.route(match, async route => {
      if (failure === 'missing') await route.fulfill({ status: 503, body: 'Unavailable' })
      else {
        const response = await route.fetch()
        const body = await response.body()
        body[0] = body[0]! ^ 1
        await route.fulfill({ response, body })
      }
    })
    await page.goto('/lab/?algorithm=gaussian-blur')
    await page.locator('.load-runtime').click()
    await expect(page.locator('image-lab')).toHaveAttribute('data-state', 'error', { timeout: 45_000 })
    await expect(page.locator('.lab-status')).toContainText(failure === 'missing' ? 'HTTP 503' : 'checksum')
    await context.unroute(match)
    await page.locator('.load-runtime').click()
    await expect(page.locator('image-lab')).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
  })
}
