import assert from 'node:assert/strict'

/** Inspect every canvas paint, not only the requested frame number or timestamp. */
export const movieShortcutsSmoke = async (page, { count, reference, width, height }) => {
  const player = page.getByLabel('Rendered output video'), frame = page.getByLabel('Output frame', { exact: true })
  const sourceTime = await page.getByLabel('Source frame', { exact: true }).inputValue()
  const settled = index => page.waitForFunction(index => {
    const p = document.querySelector('.frame-player')
    return p?.dataset.frame === String(index) && p.dataset.seeking === 'false'
  }, index)
  await settled(0)
  const decoder = page.workers().find(worker => /player\.worker/.test(worker.url()))
  assert.ok(decoder, 'Inspect the real rendered-preview decoder')
  await decoder.evaluate(() => {
    self.seekDecodeCalls = 0; self.seekResetCalls = 0
    self.originalDecode = VideoDecoder.prototype.decode
    self.originalConfigure = VideoDecoder.prototype.configure
    VideoDecoder.prototype.decode = function (...args) { self.seekDecodeCalls++; return self.originalDecode.apply(this, args) }
    VideoDecoder.prototype.configure = function (...args) { self.seekResetCalls++; return self.originalConfigure.apply(this, args) }
  })
  await page.evaluate(() => {
    window.outputPaints = []
    window.originalDrawImage = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      window.originalDrawImage.apply(this, args)
      if (this.canvas.getAttribute('aria-label') === 'Rendered output frame' && window.outputPaints) {
        const rgba = this.getImageData(0, 0, this.canvas.width, this.canvas.height).data
        window.outputPaints.push({ width: this.canvas.width, height: this.canvas.height, rgba: Array.from(rgba) })
      }
    }
  })
  const pixelsPerFrame = width * height * 3
  const assertPixels = (paints, expected) => {
    assert.ok(paints.length > 0, `Frame ${expected} must actually be painted`)
    for (const paint of paints) {
      assert.equal(paint.width, width); assert.equal(paint.height, height)
      const rgb = reference.subarray(expected * pixelsPerFrame, (expected + 1) * pixelsPerFrame)
      let difference = 0
      for (let i = 0; i < rgb.length; i++) difference += Math.abs(rgb[i] - paint.rgba[Math.floor(i / 3) * 4 + i % 3])
      const error = difference / rgb.length
      // Canvas and FFmpeg upsample 4:2:0 chroma differently. Check both bounded
      // RGB error and identity against every independently decoded reference frame.
      const nearest = Array.from({ length: count }, (_, frame) => {
        let delta = 0
        for (let i = 0; i < pixelsPerFrame; i++) delta += Math.abs(reference[frame * pixelsPerFrame + i] - paint.rgba[Math.floor(i / 3) * 4 + i % 3])
        return { frame, error: delta / pixelsPerFrame }
      }).sort((a, b) => a.error - b.error)
      assert.ok(error < 3 && error <= nearest[0].error + 0.05,
        `Every paint must show frame ${expected}, without intermediate keyframes; RGB error ${error}, nearest ${JSON.stringify(nearest.slice(0, 3))}`)
    }
  }
  const checkSeek = async (action, expected) => {
    await page.evaluate(() => { window.outputPaints = [] })
    await action(); await settled(expected)
    assertPixels(await page.evaluate(() => window.outputPaints), expected)
    assert.equal(await player.getAttribute('data-playing'), 'false')
  }
  try {
    await player.focus()
    for (const [key, expected] of [['>', 1], ['.', 2], ['<', 1], [',', 0], [',', 0]]) {
      await checkSeek(() => page.keyboard.press(key), expected)
    }
    // Both directions across separate decode dependency ranges.
    for (const index of [67, 7, 53, 19, count - 1]) await checkSeek(() => frame.fill(String(index)), index)
    // The last seek decoded the tiny fixture's dependencies. Drag backward by
    // more than two frames per update: every paint must be exact and reuse them.
    const before = await decoder.evaluate(() => [self.seekDecodeCalls, self.seekResetCalls])
    assert.ok(before[0] > 0, 'The counter must observe real uncached decoding before checking reuse')
    const track = await page.getByRole('slider', { name: 'Output timeline', exact: true }).boundingBox()
    const point = index => track.x + 7 + (track.width - 14) * index / (count - 1)
    await page.mouse.move(point(count - 1), track.y + track.height / 2); await page.mouse.down()
    try {
      await settled(count - 1)
      for (const index of [74, 69, 64, 59, 54, 49, 44, 39, 34, 29, 24, 19, 14, 9, 4, 0]) {
        await checkSeek(() => page.mouse.move(point(index), track.y + track.height / 2), index)
      }
    } finally { await page.mouse.up() }
    assert.deepEqual(await decoder.evaluate(() => [self.seekDecodeCalls, self.seekResetCalls]), before, 'Backward dragging must reuse cached pixels without decoding or restarting')
    console.log('PASS: backward pointer dragging paints exact frames with zero decoder calls or restarts')
    await checkSeek(() => frame.fill(String(count - 1)), count - 1)
    await player.focus(); await checkSeek(() => page.keyboard.press('>'), count - 1)
    await checkSeek(() => page.keyboard.press('Home'), 0)
    await checkSeek(() => page.keyboard.press('End'), count - 1)
    await checkSeek(() => frame.fill('20'), 20)
    // All keypresses arrive before the decoder can reply. Superseded paints are forbidden.
    await checkSeek(() => player.evaluate(element => {
      element.focus()
      for (const key of [...Array(18).fill('>'), ...Array(11).fill('<')]) element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    }), 27)
    await page.getByRole('button', { name: 'Play output', exact: true }).focus()
    await checkSeek(() => page.keyboard.press('>'), 28)
    await page.getByRole('slider', { name: 'Output timeline', exact: true }).focus()
    await checkSeek(() => page.keyboard.press('<'), 27)
    await frame.focus(); await page.keyboard.press('.')
    assert.equal(await player.getAttribute('data-frame'), '27', 'Numeric editing must not invoke global stepping')
    await checkSeek(() => frame.fill('5'), 5)
    await player.focus(); await page.keyboard.press('Space')
    await page.waitForFunction(() => Number(document.querySelector('.frame-player').dataset.frame) >= 8)
    await page.keyboard.press('>')
    await page.waitForFunction(() => document.querySelector('.frame-player').dataset.seeking === 'false')
    assert.equal(await player.getAttribute('data-playing'), 'false', 'A step pauses playback')
    // Keep decoding bounded when the page cannot consume frames; playback may skip to catch up.
    await page.evaluate(() => { window.outputPaints = null })
    await page.getByRole('button', { name: 'Loop output', exact: true }).click()
    await frame.fill(String(count - 3)); await settled(count - 3)
    await page.getByRole('button', { name: 'Play output', exact: true }).click()
    await page.waitForFunction(last => {
      const p = document.querySelector('.frame-player')
      return p.dataset.frame === String(last) && p.dataset.playing === 'false'
    }, count - 1)
    await page.getByRole('button', { name: 'Loop output', exact: true }).click()
    await frame.fill(String(count - 3)); await settled(count - 3)
    await page.getByRole('button', { name: 'Play output', exact: true }).click()
    await page.waitForFunction(() => Number(document.querySelector('.frame-player').dataset.frame) < 10)
    await page.getByRole('button', { name: 'Pause output', exact: true }).click()
    assert.equal(await page.getByLabel('Source frame', { exact: true }).inputValue(), sourceTime)
    console.log('PASS: actual output pixels match FFmpeg on every seek paint; focused shortcuts, rapid reversals, playback, loop/end and source isolation')
  } finally {
    await page.evaluate(() => { CanvasRenderingContext2D.prototype.drawImage = window.originalDrawImage; delete window.outputPaints; delete window.originalDrawImage })
    await decoder.evaluate(() => { VideoDecoder.prototype.decode = self.originalDecode; VideoDecoder.prototype.configure = self.originalConfigure })
  }
}
