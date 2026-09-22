import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { algorithms } from '../src/data/algorithms'
import { labRecipes } from '../src/data/labs'
const ready = async (page: Page) => {
  await expect(page.locator('image-lab')).toHaveAttribute('data-state', 'ready', { timeout: 45_000 })
}
const change = async (page: Page, action: () => Promise<unknown>) => {
  const previous = await page.locator('image-lab').getAttribute('data-result')
  await action()
  await expect(page.locator('image-lab')).not.toHaveAttribute('data-result', previous ?? '', { timeout: 45_000 })
  await ready(page)
}
const png = async (page: Page, width: number, height: number, scene = 'gradient') =>
  Buffer.from(
    await page.evaluate(
      ({ width, height, scene }) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        if (scene === 'text') {
          ctx.fillStyle = 'white'
          ctx.fillRect(0, 0, width, height)
          ctx.fillStyle = 'black'
          ctx.font = 'bold 64px sans-serif'
          ctx.fillText('HELLO', 24, 90)
        } else {
          const data = ctx.createImageData(width, height)
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const i = (y * width + x) * 4
              data.data[i] = scene === 'step' ? (x < width / 2 ? 200 : 20) : (x * 255) / width
              data.data[i + 1] = scene === 'step' ? data.data[i] : (y * 255) / height
              data.data[i + 2] = scene === 'step' ? data.data[i] : 90
              data.data[i + 3] = 255
              if (scene === 'blocks') {
                data.data[i] = 60 + (Math.floor(x / 8) % 2) * 120
                data.data[i + 1] = 80 + (Math.floor(y / 8) % 2) * 100
              }
            }
          ctx.putImageData(data, 0, 0)
        }
        return canvas.toDataURL('image/png').split(',')[1]
      },
      { width, height, scene }
    ),
    'base64'
  )
const upload = async (page: Page, buffer: Buffer, name = 'image') =>
  page.locator(`input[name="${name}"]`).setInputFiles({ name: 'custom.png', mimeType: 'image/png', buffer })

test('all 94 recipes execute native WASM, including alternate selection modes', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/lab/')
  expect(
    await page.locator('[name=algorithm] option').evaluateAll((nodes) =>
      nodes
        .map((node) => (node as HTMLOptionElement).value)
        .filter((id) => !id.startsWith('cookbook-'))
        .sort()
    )
  ).toEqual(algorithms.map((a) => a.id).sort())
  await page.locator('.load-runtime').click()
  await ready(page)
  for (const algorithm of algorithms)
    await test.step(algorithm.id, async () => {
      await change(page, () => page.locator('[name=algorithm]').selectOption(algorithm.id))
      await expect(page.locator('.lab-status')).toContainText('OpenCV 5.0.0')
      const pixels = await page.locator('canvas.output').evaluate((canvas: HTMLCanvasElement) => {
        const values = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
        return {
          width: canvas.width,
          height: canvas.height,
          opaque: values.filter((_, i) => i % 4 === 3 && values[i] === 255).length
        }
      })
      expect(pixels.width, algorithm.id).toBeGreaterThan(0)
      expect(pixels.height).toBeGreaterThan(0)
      expect(pixels.opaque, algorithm.id).toBe(pixels.width * pixels.height)
      if (algorithm.id === 'icp') await change(page, () => page.locator('.lab-parameters [name=height]').fill('0.05'))
      for (const control of labRecipes[algorithm.id].controls.filter((control) => control.options)) {
        if (algorithm.id === 'dnn-super-resolution' || algorithm.id === 'stitching') continue
        const last = control.options!.at(-1)![0]
        if (last !== String(control.value))
          await change(page, () => page.locator(`.lab-parameters [name="${control.key}"]`).selectOption(last))
      }
    })
  expect(errors).toEqual([])
})

test('guides embed their own lab without eagerly fetching WASM or models', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('/algorithms/gaussian-blur/')
  await page.getByRole('link', { name: 'Try it on your image ↓' }).click()
  const lab = page.locator('image-lab')
  await expect(lab).toHaveAttribute('data-algorithm', 'gaussian-blur')
  await expect(lab.getByLabel('Sigma (pixels)', { exact: true })).toHaveValue('1.5')
  expect(requests.filter((url) => url.includes('/runtime/') || url.endsWith('.wasm') || url.includes('/lab-assets/'))).toEqual([])
  await lab.locator('.load-runtime').click()
  await ready(page)
  await change(page, () => lab.getByLabel('Sigma (pixels)', { exact: true }).fill('5'))
  await lab.getByRole('link', { name: 'Open full lab ↗' }).click()
  await expect(page.locator('[name=algorithm]')).toHaveValue('gaussian-blur')
})

test('custom pixels, signed values and magnifier remain exact at every zoom', async ({ page }) => {
  await page.goto('/lab/?algorithm=sobel')
  await upload(page, await png(page, 96, 64, 'step'))
  await page.locator('[name=kernel]').fill('3')
  await page.locator('[name=gain]').fill('0.25')
  await page.locator('.load-runtime').click()
  await ready(page)
  await page.locator('[name=zoom]').selectOption('8')
  await page.locator('[name=pixel-x]').fill('47')
  await page.locator('[name=pixel-x]').press('Tab')
  await page.locator('[name=pixel-y]').fill('30')
  await page.locator('[name=pixel-y]').press('Tab')
  await expect(page.locator('.pixel-values').first()).toContainText('RGBA 200, 200, 200, 255')
  await expect(page.locator('.pixel-values').last()).toContainText('RGBA 180, 180, 180, 255')
  await expect(page.locator('.native-values').last()).toContainText('signed derivative: -720')
  expect(
    await page
      .locator('.pixel-card canvas')
      .last()
      .evaluate((canvas: HTMLCanvasElement) => Array.from(canvas.getContext('2d')!.getImageData(49, 49, 1, 1).data))
  ).toEqual([180, 180, 180, 255])
  const result = await page.locator('image-lab').getAttribute('data-result')
  for (const zoom of ['1', '4', '16', 'fit']) {
    await page.locator('[name=zoom]').selectOption(zoom)
    await expect(page.locator('.native-values').last()).toContainText('-720')
    await expect(page.locator('canvas.output')).toHaveAttribute('width', '96')
    await expect(page.locator('image-lab')).toHaveAttribute('data-result', result!)
  }
  await page.locator('.pixel-viewport').first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[name=pixel-x]')).toHaveValue('48')
  await expect(page.locator('.pixel-values').first()).toContainText('RGBA 20, 20, 20, 255')
  await page.keyboard.press('Escape')
  await expect(page.locator('.unpin-pixel')).toBeDisabled()
})

test('uploads, second-image inspection, pan and downloads use the processed resolution', async ({ page }) => {
  await page.goto('/lab/?algorithm=quality-metrics')
  const buffer = await png(page, 1200, 600)
  await upload(page, buffer)
  await upload(page, buffer, 'second')
  await page.locator('.load-runtime').click()
  await ready(page)
  await expect(page.locator('canvas.input')).toHaveAttribute('width', '1024')
  await expect(page.locator('.source-note')).toContainText('1200 × 600 original → 1024 × 512 processed')
  await expect(page.locator('.result-note')).toContainText('SSIM: 1.000000')
  await page.locator('[name=inspect-input]').selectOption('second')
  await page.locator('[name=zoom]').selectOption('4')
  await page
    .locator('.pixel-viewport')
    .first()
    .evaluate((pane) => {
      pane.scrollLeft = 400
      pane.scrollTop = 120
    })
  await expect
    .poll(() =>
      page
        .locator('.pixel-viewport')
        .last()
        .evaluate((pane) => Math.round(pane.scrollLeft))
    )
    .toBe(400)
  const downloaded = page.waitForEvent('download')
  await page.locator('.download').click()
  expect((await downloaded).suggestedFilename()).toBe('opencv-quality-metrics.png')
  await change(page, () => page.locator('[name=resolution]').selectOption('640'))
  await expect(page.locator('canvas.output')).toHaveAttribute('width', '640')
  await change(page, () => page.locator('.reset-image').click())
  await expect(page.locator('canvas.input')).toHaveAttribute('width', '448')
})

test('model uploads recognize text, upscale pixels and recover from invalid models', async ({ page }) => {
  await page.goto('/lab/?algorithm=ocr')
  await upload(page, await png(page, 400, 130, 'text'))
  await page.locator('[name=language]').setInputFiles('public/lab-assets/eng.traineddata')
  await page.locator('.load-runtime').click()
  await ready(page)
  await expect(page.locator('.result-note')).toContainText('HELLO')
  await change(page, () => page.locator('[name=algorithm]').selectOption('dnn-super-resolution'))
  await expect(page.locator('canvas.output')).toHaveAttribute('width', '512')
  await change(page, () => page.locator('[name=model]').setInputFiles('public/lab-assets/FSRCNN_x2.pb'))
  await expect(page.locator('.result-note')).toContainText('uploaded')
  await change(page, () => page.locator('[name=algorithm]').selectOption('dnn-inference'))
  await change(page, () => page.locator('[name=model]').setInputFiles('../tests/fixtures/relu.onnx'))
  await expect(page.locator('.result-note')).toContainText('Uploaded network')
  await page
    .locator('[name=model]')
    .setInputFiles({ name: 'bad.onnx', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid model') })
  await expect(page.locator('image-lab')).toHaveAttribute('data-state', 'error', { timeout: 30000 })
  await expect(page.locator('.download')).toBeDisabled()
  await change(page, () => page.locator('[name=algorithm]').selectOption('gaussian-blur'))
})

test('stale results are discarded, validation recovers, and stop permits a fresh worker', async ({ page }) => {
  await page.goto('/lab/?algorithm=threshold')
  await page.locator('.load-runtime').click()
  await ready(page)
  await page.locator('[name=auto]').uncheck()
  await page.locator('[name=threshold]').fill('200')
  await expect(page.locator('.download')).toBeDisabled()
  await expect(page.locator('.pixel-values').last()).toContainText('Run an experiment')
  await page.locator('[name=auto]').check()
  await ready(page)
  const previous = await page.locator('image-lab').getAttribute('data-result')
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('.load-runtime')!.click()
    const field = document.querySelector<HTMLInputElement>('[name=threshold]')!
    for (const value of ['50', '255']) {
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await expect(page.locator('image-lab')).not.toHaveAttribute('data-result', previous!)
  await ready(page)
  await expect(page.locator('.result-note')).toContainText('Threshold used: 255.00')
  expect(
    await page.locator('canvas.output').evaluate((canvas: HTMLCanvasElement) =>
      canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.some((v, i) => i % 4 !== 3 && v !== 0)
    )
  ).toBe(false)
  await change(page, () => page.locator('[name=algorithm]').selectOption('filter2d'))
  await page.locator('textarea[name=kernel]').fill('[[1,2], [3]]')
  await expect(page.locator('image-lab')).toHaveAttribute('data-state', 'error')
  await change(page, () => page.locator('textarea[name=kernel]').fill('[[0,0,0],[0,1,0],[0,0,0]]'))
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('.load-runtime')!.click()
    document.querySelector<HTMLButtonElement>('.cancel-run')!.click()
  })
  await expect(page.locator('.lab-status')).toContainText('Stopped')
  await page.locator('.load-runtime').click()
  await ready(page)
})

test('mobile pixel viewers fit in both themes and remain keyboard accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/algorithms/gaussian-blur/')
  await page.locator('.load-runtime').click()
  await ready(page)
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
    }, theme)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.locator('[name=zoom]').selectOption('16')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.locator('.pixel-viewport').last().focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.pixel-state')).toContainText('Pinned')
    const cross = page.locator('.pixel-viewport').last().locator('.pixel-crosshair')
    await expect
      .poll(async () => {
        const pixel = await cross.boundingBox(),
          pane = await page.locator('.pixel-viewport').last().boundingBox()
        return (
          !!pixel &&
          !!pane &&
          pixel.x >= pane.x &&
          pixel.y >= pane.y &&
          pixel.x + pixel.width <= pane.x + pane.width &&
          pixel.y + pixel.height <= pane.y + pane.height
        )
      })
      .toBe(true)
    await page.locator('image-lab').screenshot({ path: `test-results/lab-${theme}-mobile.png` })
  }
})

test('all guides expose a lab and bundled models retain pinned checksums', async () => {
  const { createHash } = await import('node:crypto')
  for (const algorithm of algorithms) {
    const html = await readFile(`dist/algorithms/${algorithm.id}/index.html`, 'utf8')
    expect(html).toContain(`<image-lab data-algorithm="${algorithm.id}"`)
    expect(html).toContain('id="lab"')
  }
  for (const [name, hash] of [
    ['eng.traineddata', '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2'],
    ['FSRCNN_x2.pb', '366b33f0084c7b3f2bf6724f0a2c77bca94fcec9d7b6d72389d330073b380d5c']
  ])
    expect(
      createHash('sha256')
        .update(await readFile(`public/lab-assets/${name}`))
        .digest('hex')
    ).toBe(hash)
})

test('a pending model file cannot run against the previous model', async ({ page }) => {
  await page.goto('/lab/?algorithm=dnn-inference')
  await page.locator('.load-runtime').click()
  await ready(page)
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      const bytes = await original.call(this)
      await new Promise<void>((resolve) => {
        ;(window as unknown as { finishUpload: () => void }).finishUpload = resolve
      })
      return bytes
    }
  })
  await page.locator('[name=model]').setInputFiles('../tests/fixtures/relu.onnx')
  await expect(page.locator('.load-runtime')).toBeDisabled()
  await expect(page.locator('.download')).toBeDisabled()
  await expect(page.locator('.pixel-values').last()).toContainText('Run an experiment')
  await page.locator('[name=size]').fill('80')
  await page.evaluate(() => (window as unknown as { finishUpload: () => void }).finishUpload())
  await ready(page)
  await expect(page.locator('.result-note')).toContainText('Uploaded network')
  await expect(page.locator('canvas.output')).toHaveAttribute('width', '80')
  await change(page, () => page.getByRole('button', { name: 'Use bundled model' }).click())
  await expect(page.locator('.result-note')).toContainText('Built-in ReLU demo')
})

test('zoom, pan and pixel inspection follow the same area across output resolutions', async ({ page }) => {
  await page.goto('/lab/?algorithm=resize')
  await page.locator('.load-runtime').click()
  await ready(page)
  const view = () =>
    page.locator('.pixel-viewport').evaluateAll((panes) =>
      panes.map((pane) => {
        const canvas = pane.querySelector('canvas')!,
          box = canvas.getBoundingClientRect()
        return {
          x: (pane.scrollLeft + pane.clientWidth / 2) / box.width,
          y: (pane.scrollTop + pane.clientHeight / 2) / box.height,
          width: box.width,
          height: box.height,
          visibleX: pane.clientWidth / box.width,
          visibleY: pane.clientHeight / box.height
        }
      })
    )
  const aligned = async () => {
    await expect
      .poll(async () => {
        const [a, b] = await view()
        return Math.max(
          Math.abs(a.x - b.x),
          Math.abs(a.y - b.y),
          Math.abs(a.visibleX - b.visibleX),
          Math.abs(a.visibleY - b.visibleY)
        )
      })
      .toBeLessThan(0.002)
  }
  await page.locator('[name=zoom]').selectOption('4')
  for (const scale of ['0.5', '2', '0.2']) {
    if (scale !== '0.5') await change(page, () => page.locator('.lab-parameters [name=scale]').fill(scale))
    await aligned()
    for (const index of [0, 1]) {
      await page
        .locator('.pixel-viewport')
        .nth(index)
        .evaluate((pane) => {
          const canvas = pane.querySelector('canvas')!
          pane.scrollLeft = canvas.clientWidth * 0.65 - pane.clientWidth / 2
          pane.scrollTop = canvas.clientHeight * 0.4 - pane.clientHeight / 2
        })
      await aligned()
      const before = (await view())[index]
      await page.locator('.zoom-in').click()
      await aligned()
      const after = (await view())[index]
      expect(Math.abs(after.x - before.x)).toBeLessThan(0.002)
      expect(Math.abs(after.y - before.y)).toBeLessThan(0.002)
      await page.locator('.zoom-out').click()
      await aligned()
    }
  }
  await change(page, () => page.locator('.lab-parameters [name=scale]').fill('0.5'))
  await page.locator('[name=pixel-x]').fill('301')
  await page.locator('[name=pixel-x]').press('Tab')
  await page.locator('[name=pixel-y]').fill('201')
  await page.locator('[name=pixel-y]').press('Tab')
  await expect(page.locator('.pixel-values').first()).toContainText('(301, 201)')
  await expect(page.locator('.pixel-values').last()).toContainText('(150, 100)')
  await page.locator('[name=pixel-source]').selectOption('1')
  await expect(page.locator('[name=pixel-x]')).toHaveValue('150')
  const result = await page.locator('image-lab').getAttribute('data-result')
  for (const index of [0, 1])
    for (const deltaY of [-100, 100]) {
      const pane = page.locator('.pixel-viewport').nth(index)
      await pane.scrollIntoViewIfNeeded()
      const anchor = await pane.evaluate((element) => {
        const canvas = element.querySelector('canvas')!,
          x = element.clientWidth * 0.35,
          y = element.clientHeight * 0.4,
          box = element.getBoundingClientRect()
        return {
          u: (element.scrollLeft + x) / canvas.clientWidth,
          v: (element.scrollTop + y) / canvas.clientHeight,
          clientX: box.left + element.clientLeft + x,
          clientY: box.top + element.clientTop + y,
          scrollY: window.scrollY
        }
      })
      const beforeZoom = await page.locator('[name=zoom]').inputValue()
      await page.mouse.move(anchor.clientX, anchor.clientY)
      await page.mouse.wheel(0, deltaY)
      await expect(page.locator('[name=zoom]')).toHaveValue(String(Number(beforeZoom) * (deltaY < 0 ? 2 : 0.5)))
      const after = await pane.evaluate((element) => {
        const canvas = element.querySelector('canvas')!
        return {
          u: (element.scrollLeft + element.clientWidth * 0.35) / canvas.clientWidth,
          v: (element.scrollTop + element.clientHeight * 0.4) / canvas.clientHeight,
          scrollY: window.scrollY
        }
      })
      expect(Math.abs(after.u - anchor.u)).toBeLessThan(0.002)
      expect(Math.abs(after.v - anchor.v)).toBeLessThan(0.002)
      expect(after.scrollY).toBe(anchor.scrollY)
      await expect(page.locator('image-lab')).toHaveAttribute('data-result', result!)
      await aligned()
    }
  await page.locator('[name=zoom]').selectOption('fit')
  const [input, output] = await view()
  expect(Math.abs(input.width - output.width)).toBeLessThan(1)
  await expect(page.locator('canvas.input')).toHaveAttribute('width', '448')
  await expect(page.locator('canvas.output')).toHaveAttribute('width', '224')
})

test('pixel magnifiers keep features at output scale across resolutions and image edges', async ({ page }) => {
  await page.goto('/lab/?algorithm=resize')
  await upload(page, await png(page, 96, 64, 'blocks'))
  await page.locator('[name=interpolation]').selectOption('nearest')
  await page.locator('.load-runtime').click()
  await ready(page)
  const magnifiers = () =>
    page.locator('.pixel-card canvas').evaluateAll((nodes) =>
      nodes.map((node) => {
        const canvas = node as HTMLCanvasElement
        return Array.from(canvas.getContext('2d')!.getImageData(0, 0, 99, 99).data)
      })
    )
  for (const scale of [0.5, 1, 2]) {
    if (scale !== 0.5) await change(page, () => page.locator('.lab-parameters [name=scale]').fill(String(scale)))
    for (const source of [0, 1]) {
      await page.locator('[name=pixel-source]').selectOption(String(source))
      const width = source ? 96 * scale : 96,
        height = source ? 64 * scale : 64
      for (const [x, y] of [
        [Math.floor(width * 0.4), Math.floor(height * 0.4)],
        [0, 0],
        [width - 1, height - 1]
      ]) {
        await page.locator('[name=pixel-x]').fill(String(x))
        await page.locator('[name=pixel-x]').press('Tab')
        await page.locator('[name=pixel-y]').fill(String(y))
        await page.locator('[name=pixel-y]').press('Tab')
        const [input, output] = await magnifiers()
        // The native-pixel outlines intentionally differ in size. Every surrounding
        // feature and transparent edge must occupy the same magnifier coordinates.
        let different = 0
        for (let y = 0; y < 99; y++)
          for (let x = 0; x < 99; x++) {
            if (x > 23 && x < 75 && y > 23 && y < 75) continue
            for (let c = 0; c < 4; c++) {
              const offset = (y * 99 + x) * 4 + c
              if (input[offset] !== output[offset]) different++
            }
          }
        expect(different, `${scale}x output, source ${source}, pixel ${x},${y}`).toBe(0)
        const actual = await page
          .locator('.lab-main-canvas')
          .nth(source)
          .evaluate(
            (canvas: HTMLCanvasElement, point) =>
              Array.from(canvas.getContext('2d')!.getImageData(point.x, point.y, 1, 1).data),
            { x, y }
          )
        await expect(page.locator('.pixel-values').nth(source)).toContainText(`RGBA ${actual.join(', ')}`)
      }
    }
  }
  const before = await magnifiers(),
    result = await page.locator('image-lab').getAttribute('data-result')
  for (const zoom of ['1', '8', 'fit']) {
    await page.locator('[name=zoom]').selectOption(zoom)
    expect(await magnifiers()).toEqual(before)
    await expect(page.locator('image-lab')).toHaveAttribute('data-result', result!)
  }
  await change(page, () => page.locator('.lab-parameters [name=scale]').fill('0.5'))
  await page.locator('[name=pixel-x]').fill('19')
  await page.locator('[name=pixel-x]').press('Tab')
  await page.locator('[name=pixel-y]').fill('12')
  await page.locator('[name=pixel-y]').press('Tab')
  await page.locator('.pixel-inspector').screenshot({ path: 'test-results/pixel-inspector-shared-scale.png' })
})
