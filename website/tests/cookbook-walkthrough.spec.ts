import { test, expect } from '@playwright/test'
import { cookbook } from '../src/data/cookbook'
import { cookbookExplanations } from '../src/data/cookbook-explanations'
import type { CookbookVisualManifest } from '../src/data/cookbook-visuals'
import snapshots from '../src/data/cookbook-visuals.generated.json' with { type: 'json' }
const manifest = snapshots as CookbookVisualManifest

test('every cookbook shows the native image and explanation belonging to each pipeline step', async ({ page }) => {
  test.setTimeout(120_000)
  const engines: string[] = [],
    errors: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/runtime/') || request.url().endsWith('.wasm')) engines.push(request.url())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  for (const recipe of cookbook)
    await test.step(recipe.id, async () => {
      await page.goto(`/cookbook/${recipe.id}/#pipeline`)
      const diagram = page.locator('cookbook-walkthrough'),
        visual = manifest.recipes[recipe.id]
      await expect(diagram.locator('[data-step]')).toHaveCount(recipe.steps.length)
      for (let i = 0; i < recipe.steps.length; i++) {
        await diagram.locator(`[data-step="${i}"]`).click()
        await expect(diagram.locator('[data-explanation]:visible')).toHaveCount(1)
        await expect(diagram.locator('[data-explanation]:visible')).toContainText(
          cookbookExplanations[recipe.id].stages[i].why
        )
        const previous = i === 0 ? visual.input : visual.stages[i - 1].at(-1)!
        await expect(diagram.locator('[data-reference-image]')).toHaveAttribute('src', previous.src)
        for (const [j, frame] of visual.stages[i].entries()) {
          if (visual.stages[i].length > 1)
            await diagram.locator(`[data-output-step="${i}"] [data-frame-button="${j}"]`).click()
          const priorImage = j > 0 ? visual.stages[i][j - 1] : previous
          await expect(diagram.locator('[data-reference-image]')).toHaveAttribute('src', priorImage.src)
          const image = diagram.locator('[data-output-step]:visible [data-output-frame]:visible img')
          await expect(image).toHaveAttribute('src', frame.src)
          await expect
            .poll(() =>
              image.evaluate(
                (img: HTMLImageElement) =>
                  img.complete &&
                  img.naturalWidth === Number(img.getAttribute('width')) &&
                  img.naturalHeight === Number(img.getAttribute('height'))
              )
            )
            .toBe(true)
          await expect(diagram.locator('[data-output-step]:visible')).toContainText(frame.description)
        }
      }
      await diagram.locator('[name=walkthrough-reference]').selectOption('original')
      await expect(diagram.locator('[data-reference-image]')).toHaveAttribute('src', visual.input.src)
      if (visual.second) {
        await diagram.locator('[name=walkthrough-reference]').selectOption('second')
        await expect(diagram.locator('[data-reference-image]')).toHaveAttribute('src', visual.second.src)
      }
      await expect(page.locator('.lab-status')).toContainText('engine loads on your first run')
    })
  expect(engines).toEqual([])
  expect(errors).toEqual([])
})

test('keyboard and playback traverse substeps and stop on manual selection', async ({ page }) => {
  await page.clock.install()
  await page.goto('/cookbook/motion-vectors/#pipeline')
  const diagram = page.locator('cookbook-walkthrough')
  await diagram.locator('[data-step="0"]').focus()
  await page.keyboard.press('ArrowRight')
  await expect(diagram).toHaveAttribute('data-stage', '1')
  await page.keyboard.press('End')
  await expect(diagram).toHaveAttribute('data-stage', '2')
  await diagram.getByRole('button', { name: 'Next walkthrough image' }).click()
  await expect(diagram).toHaveAttribute('data-frame', '1')
  await diagram.getByRole('button', { name: 'Previous walkthrough image' }).click()
  await expect(diagram).toHaveAttribute('data-frame', '0')
  await diagram.getByRole('button', { name: 'Play cookbook steps' }).click()
  const frames = manifest.recipes['motion-vectors'].stages.flat().length
  for (let i = 0; i < frames; i++) await page.clock.fastForward(4550)
  await expect(diagram).toHaveAttribute('data-stage', '2')
  await expect(diagram).toHaveAttribute('data-frame', '2')
  await expect(diagram).toHaveAttribute('data-playing', 'false')
  await expect(diagram.locator('[data-next]')).toBeDisabled()
  await diagram.getByRole('button', { name: 'Play cookbook steps' }).click()
  await page.clock.fastForward(4550)
  await diagram.locator('[data-step="0"]').click()
  await page.clock.fastForward(10000)
  await expect(diagram).toHaveAttribute('data-stage', '0')
  await expect(diagram).toHaveAttribute('data-playing', 'false')
  await expect(diagram.locator('[data-previous]')).toBeDisabled()
  await diagram.getByRole('button', { name: 'Play cookbook steps' }).click()
  await diagram.evaluate((element) => {
    const parent = element.parentElement!
    element.remove()
    parent.append(element)
  })
  await page.clock.fastForward(5000)
  await expect(diagram).toHaveAttribute('data-playing', 'false')
  await expect(diagram).toHaveAttribute('data-stage', '0')
})

test('mobile and JavaScript-free pages retain visible, readable teaching images', async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.goto('/cookbook/segment-touching/#pipeline')
  const diagram = page.locator('cookbook-walkthrough')
  await diagram.locator('[data-step="1"]').click()
  await diagram.getByRole('button', { name: 'Labelled seed locations', exact: true }).click()
  const left = await diagram.locator('.walkthrough-reference').boundingBox()
  const right = await diagram.locator('.walkthrough-outputs').boundingBox()
  expect(right!.y).toBeGreaterThan(left!.y + left!.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await diagram.screenshot({ path: 'test-results/cookbook-walkthrough-mobile.png' })
  const context = await browser.newContext({ javaScriptEnabled: false })
  const staticPage = await context.newPage()
  await staticPage.goto('/cookbook/track-region/#pipeline')
  await expect(staticPage.locator('[data-output-step="0"] img')).toBeVisible()
  await expect(staticPage.locator('[data-explanation="0"]')).toContainText('Shi-Tomasi')
  await context.close()
})

test('native result contact sheets for visual review', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  for (let start = 0; start < cookbook.length; start += 6) {
    await page.setContent(
      `<style>body{background:#101722;color:#e4e8f0;font:13px system-ui;margin:18px}section{display:flex;gap:12px;margin-bottom:25px}figure{flex:1;min-width:0;margin:0}img{width:100%;height:170px;object-fit:contain;background:#172030}figcaption{min-height:32px;font-size:12px}h2{font-size:16px}</style>` +
        cookbook
          .slice(start, start + 6)
          .map((recipe) => {
            const v = manifest.recipes[recipe.id]
            return `<h2>${recipe.title}</h2><section>${[v.input, ...v.stages.flat()].map((f) => `<figure><figcaption>${f.title}</figcaption><img src="http://localhost:4321${f.src}"></figure>`).join('')}</section>`
          })
          .join('')
    )
    await page
      .locator('img')
      .evaluateAll((images) => Promise.all(images.map((img) => (img as HTMLImageElement).decode())))
    await page.screenshot({ path: `test-results/cookbook-walkthrough-sheet-${start / 6 + 1}.png`, fullPage: true })
  }
})
