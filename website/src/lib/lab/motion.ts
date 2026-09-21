import { mint, orange, type Experiment } from './context'
import type { NativePixels } from './types'

const median = (values: number[]) => {
  if (!values.length) return NaN
  values.sort((a, b) => a - b)
  const mid = Math.floor(values.length / 2)
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2
}

/** Measure image displacement with dense flow, reject weak/inconsistent samples, and report robust grid vectors. */
export const motionVectors = (e: Experiment): void => {
  const { cv, gray, bgr, out } = e,
    width = gray.cols,
    height = gray.rows,
    count = width * height,
    after = e.second(true),
    firstFloat = e.mat(),
    secondFloat = e.mat(),
    hann = e.mat()
  gray.convertTo(firstFloat, cv.CV_32F)
  after.convertTo(secondFloat, cv.CV_32F)
  cv.createHanningWindow(hann, e.size(), cv.CV_32F)
  const phase = cv.phaseCorrelate(firstFloat, secondFloat, hann)
  const initialized =
    Number.isFinite(phase.value.x) &&
    Number.isFinite(phase.value.y) &&
    phase.response >= 0.1 &&
    Math.abs(phase.value.x) < width * 0.45 &&
    Math.abs(phase.value.y) < height * 0.45
  const seedX = initialized ? phase.value.x : 0,
    seedY = initialized ? phase.value.y : 0
  const toFirst = e.array(2, 3, cv.CV_64F, [1, 0, -seedX, 0, 1, -seedY]),
    toSecond = e.array(2, 3, cv.CV_64F, [1, 0, seedX, 0, 1, seedY]),
    alignedAfter = e.mat(),
    alignedBefore = e.mat(),
    preview = e.mat(),
    forward = e.mat(),
    backward = e.mat()
  cv.warpAffine(after, alignedAfter, toFirst, e.size(), cv.INTER_LINEAR, cv.BORDER_REFLECT_101)
  cv.warpAffine(gray, alignedBefore, toSecond, e.size(), cv.INTER_LINEAR, cv.BORDER_REFLECT_101)
  cv.warpAffine(e.second(), preview, toFirst, e.size(), cv.INTER_LINEAR, cv.BORDER_REFLECT_101)
  e.stage(
    'Pan-compensated second frame',
    preview,
    `The phase-correlation estimate (${seedX.toFixed(3)}, ${seedY.toFixed(3)}) px is removed before local flow estimation. Full displacement is restored in the reported vectors.`
  )
  cv.calcOpticalFlowFarneback(gray, alignedAfter, forward, 0.5, e.n('levels'), e.n('window'), 5, 7, 1.5, 0)
  cv.calcOpticalFlowFarneback(after, alignedBefore, backward, 0.5, e.n('levels'), e.n('window'), 5, 7, 1.5, 0)
  const texture = e.mat()
  cv.cornerMinEigenVal(gray, texture, 7, 3)
  const peak = cv.minMaxLoc(texture).maxVal,
    threshold = (peak * e.n('texture')) / 100
  // Copy before allocating any more native matrices: WASM heap growth can detach its views.
  const flow = Float32Array.from(forward.data32F),
    reverse = Float32Array.from(backward.data32F),
    eigen = Float32Array.from(texture.data32F)
  for (let i = 0; i < count; i++) {
    flow[i * 2] += seedX
    flow[i * 2 + 1] += seedY
    reverse[i * 2] -= seedX
    reverse[i * 2 + 1] -= seedY
  }
  // Show the actual estimator output before the validity filter, including ambiguous areas.
  const unfilteredHSV = new Uint8Array(count * 3)
  for (let i = 0; i < count; i++) {
    const dx = flow[i * 2],
      dy = flow[i * 2 + 1]
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue
    unfilteredHSV[i * 3] = (((Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI)) * 90) / Math.PI
    unfilteredHSV[i * 3 + 1] = 255
    unfilteredHSV[i * 3 + 2] = Math.min(255, (Math.hypot(dx, dy) * 255) / e.n('range'))
  }
  const unfilteredColour = e.mat()
  cv.cvtColor(e.array(height, width, cv.CV_8UC3, unfilteredHSV), unfilteredColour, cv.COLOR_HSV2BGR)
  e.stage(
    'Raw flow before validation',
    unfilteredColour,
    `Full displacement before texture and round-trip rejection. Hue: right red, down yellow-green, left cyan, up violet. Brightness saturates at ${e.n('range')} px. These estimates include unsupported guesses in flat areas; the next step checks them.`,
    { values: flow, channels: 2, labels: ['unfiltered dx (px)', 'unfiltered dy (px)'] }
  )
  const accepted = new Uint8Array(count),
    errors = new Float32Array(count).fill(NaN),
    xs: number[] = [],
    ys: number[] = []
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        dx = flow[i * 2],
        dy = flow[i * 2 + 1],
        qx = x + dx,
        qy = y + dy
      if (!Number.isFinite(qx) || !Number.isFinite(qy) || qx < 0 || qy < 0 || qx > width - 1 || qy > height - 1)
        continue
      const x0 = Math.floor(qx),
        y0 = Math.floor(qy),
        x1 = Math.min(width - 1, x0 + 1),
        y1 = Math.min(height - 1, y0 + 1),
        fx = qx - x0,
        fy = qy - y0
      const sample = (channel: number) =>
        (reverse[(y0 * width + x0) * 2 + channel] * (1 - fx) + reverse[(y0 * width + x1) * 2 + channel] * fx) *
          (1 - fy) +
        (reverse[(y1 * width + x0) * 2 + channel] * (1 - fx) + reverse[(y1 * width + x1) * 2 + channel] * fx) * fy
      errors[i] = Math.hypot(dx + sample(0), dy + sample(1))
      if (peak > 1e-9 && eigen[i] >= threshold && errors[i] <= e.n('tolerance')) {
        accepted[i] = 255
        xs.push(dx)
        ys.push(dy)
      }
    }
  const acceptedCount = xs.length,
    dominantX = xs.length >= 16 ? median(xs) : NaN,
    dominantY = ys.length >= 16 ? median(ys) : NaN,
    residual = e.s('mode') === 'residual',
    baseX = residual ? dominantX : 0,
    baseY = residual ? dominantY : 0,
    range = e.n('range'),
    hsv = new Uint8Array(count * 3),
    dense = new Float32Array(count * 5).fill(NaN)
  for (let i = 0; i < count; i++) {
    dense[i * 5 + 3] = errors[i]
    dense[i * 5 + 4] = accepted[i] ? 1 : 0
    if (!accepted[i]) continue
    const dx = flow[i * 2] - baseX,
      dy = flow[i * 2 + 1] - baseY,
      magnitude = Math.hypot(dx, dy)
    dense.set([dx, dy, magnitude], i * 5)
    hsv[i * 3] = (((Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI)) * 90) / Math.PI
    hsv[i * 3 + 1] = 255
    hsv[i * 3 + 2] = Math.min(255, (magnitude * 255) / range)
  }
  const field: NativePixels = {
    values: dense,
    channels: 5,
    labels: [
      residual ? 'residual dx (px)' : 'dx (px)',
      residual ? 'residual dy (px)' : 'dy (px)',
      'magnitude (px)',
      'backward error (px)',
      'passes checks (1=yes)'
    ]
  }
  const colour = e.mat()
  cv.cvtColor(e.array(height, width, cv.CV_8UC3, hsv), colour, cv.COLOR_HSV2BGR)
  const legend = `Dense map hue: right red, down yellow-green, left cyan, up violet. Brightness saturates at ${range} px. Black can mean zero motion or rejected data; inspect the validity mask.`
  e.stage(residual ? 'Residual displacement' : 'Dense displacement', colour, legend, field)
  e.stage(
    'Accepted samples',
    e.array(height, width, cv.CV_8U, accepted),
    'White pixels have enough local texture and pass the forward/backward check. This is a validity filter, not a calibrated confidence score.',
    field
  )
  const regions: {
    x: number
    y: number
    width: number
    height: number
    dx: number | null
    dy: number | null
    totalDx: number | null
    totalDy: number | null
    magnitude: number | null
    acceptedFraction: number
    acceptedPixels: number
  }[] = []
  const values = new Float32Array(count * 7).fill(NaN),
    cell = e.n('cell'),
    gain = e.n('gain')
  bgr.convertTo(out, -1, 0.65)
  for (let y = 0; y < height; y += cell)
    for (let x = 0; x < width; x += cell) {
      const w = Math.min(cell, width - x),
        h = Math.min(cell, height - y),
        vx: number[] = [],
        vy: number[] = []
      for (let py = y; py < y + h; py++)
        for (let px = x; px < x + w; px++) {
          const i = py * width + px
          if (accepted[i]) {
            vx.push(flow[i * 2])
            vy.push(flow[i * 2 + 1])
          }
        }
      const supported = vx.length >= Math.max(8, Math.ceil(w * h * 0.05)),
        fraction = vx.length / (w * h),
        totalDx = supported ? median(vx) : NaN,
        totalDy = supported ? median(vy) : NaN,
        dx = totalDx - baseX,
        dy = totalDy - baseY,
        magnitude = Math.hypot(dx, dy),
        valid = Number.isFinite(magnitude)
      regions.push({
        x,
        y,
        width: w,
        height: h,
        dx: valid ? dx : null,
        dy: valid ? dy : null,
        totalDx: supported ? totalDx : null,
        totalDy: supported ? totalDy : null,
        magnitude: valid ? magnitude : null,
        acceptedFraction: fraction,
        acceptedPixels: vx.length
      })
      for (let py = y; py < y + h; py++)
        for (let px = x; px < x + w; px++) {
          const i = py * width + px
          values.set([dx, dy, magnitude, fraction, dense[i * 5], dense[i * 5 + 1], errors[i]], i * 7)
        }
      cv.rectangle(out, { x, y }, { x: x + w - 1, y: y + h - 1 }, [100, 100, 100, 255], 1)
      const center = { x: Math.round(x + (w - 1) / 2), y: Math.round(y + (h - 1) / 2) }
      if (valid) {
        const colour = residual ? orange : mint
        if (magnitude * gain >= 0.5)
          cv.arrowedLine(
            out,
            center,
            { x: Math.round(center.x + dx * gain), y: Math.round(center.y + dy * gain) },
            colour,
            2
          )
        else cv.circle(out, center, 2, colour, -1)
        if (w >= 40 && h >= 24)
          cv.putText(
            out,
            `${Math.round(dx)},${Math.round(dy)}`,
            { x: x + 3, y: y + 12 },
            cv.FONT_HERSHEY_SIMPLEX,
            0.3,
            colour,
            1
          )
      } else {
        cv.line(
          out,
          { x: center.x - 2, y: center.y - 2 },
          { x: center.x + 2, y: center.y + 2 },
          [130, 130, 130, 255],
          1
        )
        cv.line(
          out,
          { x: center.x + 2, y: center.y - 2 },
          { x: center.x - 2, y: center.y + 2 },
          [130, 130, 130, 255],
          1
        )
      }
    }
  e.native = {
    values,
    channels: 7,
    labels: [
      residual ? 'region residual dx (px)' : 'region dx (px)',
      residual ? 'region residual dy (px)' : 'region dy (px)',
      'region magnitude (px)',
      'accepted fraction',
      'pixel dx (px)',
      'pixel dy (px)',
      'backward error (px)'
    ]
  }
  const dominant = Number.isFinite(dominantX) && Number.isFinite(dominantY) ? { dx: dominantX, dy: dominantY } : null,
    measured = regions.filter((region) => region.dx !== null).length
  e.note = `${dominant ? `Dominant image translation: dx ${dominant.dx.toFixed(3)}, dy ${dominant.dy.toFixed(3)} px.` : 'Insufficient texture or consistent flow to estimate dominant translation.'}\n${measured} / ${regions.length} grid regions measured; ${((100 * acceptedCount) / count).toFixed(1)}% of pixels pass checks. ${residual ? 'Vectors have dominant translation subtracted.' : 'Vectors describe total input-to-second displacement.'}\nArrows start on the first image. Labels are rounded dx,dy; inspect for precise values. Arrow display multiplier ${gain}× does not change measured values. Dots mark near-zero motion; grey crosses mean insufficient evidence.\n${legend}`
  e.download = {
    filename: 'opencv-motion-vectors.json',
    mimeType: 'application/json',
    label: 'Save vectors JSON',
    text: JSON.stringify(
      {
        width,
        height,
        units: 'processed-image pixels per frame pair',
        coordinates: 'Input (x,y) maps to second (x+totalDx,y+totalDy); +x right, +y down.',
        vectorMode: residual ? 'residual-after-dominant-translation' : 'total',
        dominantTranslation: dominant,
        phaseAlignment: { used: initialized, dx: seedX, dy: seedY, response: phase.response },
        cellSize: cell,
        acceptedPixels: acceptedCount,
        note: 'Regions summarize accepted samples. Null means insufficient evidence; acceptedFraction is not a probability. The second image is resized to the first image dimensions.',
        regions
      },
      null,
      2
    )
  }
}
