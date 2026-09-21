import { palette as c, rect, label, arrow, shot, visual, type Visual } from './primitives'

/** Floating-point grayscale samples for the pyramid lesson; dimensions stay even until the coarsest level. */
export type PyramidImage = { width: number; height: number; pixels: number[] }

const kernel = [1, 4, 6, 4, 1]
const reflect101 = (coordinate: number, size: number): number => {
  while (coordinate < 0 || coordinate >= size) coordinate = coordinate < 0 ? -coordinate : 2 * size - coordinate - 2
  return coordinate
}

const down = (image: PyramidImage): PyramidImage => {
  const width = image.width / 2,
    height = image.height / 2
  const pixels = Array.from({ length: width * height }, (_, i) => {
    const x = (i % width) * 2,
      y = Math.floor(i / width) * 2
    let sum = 0
    for (let v = -2; v <= 2; v++)
      for (let u = -2; u <= 2; u++) {
        sum +=
          image.pixels[reflect101(y + v, image.height) * image.width + reflect101(x + u, image.width)] *
          kernel[u + 2] *
          kernel[v + 2]
      }
    return sum / 256
  })
  return { width, height, pixels }
}

const up = (image: PyramidImage): PyramidImage => {
  const width = image.width * 2,
    height = image.height * 2
  const pixels = Array.from({ length: width * height }, (_, i) => {
    const x = i % width,
      y = Math.floor(i / width)
    let sum = 0
    // Reflect the expanded lattice, including its inserted zeros. Reflecting the
    // small source directly produces different values at the right/bottom edges.
    for (let v = -2; v <= 2; v++)
      for (let u = -2; u <= 2; u++) {
        const sx = reflect101(x + u, width),
          sy = reflect101(y + v, height)
        if (sx % 2 === 0 && sy % 2 === 0)
          sum += image.pixels[(sy / 2) * image.width + sx / 2] * kernel[u + 2] * kernel[v + 2]
      }
    return sum / 64
  })
  return { width, height, pixels }
}

const combine = (a: PyramidImage, b: PyramidImage, sign: number): PyramidImage => ({
  width: a.width,
  height: a.height,
  pixels: a.pixels.map((v, i) => v + sign * b.pixels[i])
})

/** Compute the displayed Gaussian levels, signed residuals and reconstruction without rounding or clipping.
 * Uses the OpenCV five-tap pyramid kernel and REFLECT_101 borders on this fixed even-sized example.
 * The native-runtime comparison test checks the filtering and boundary values independently.
 */
export function buildPyramidExample() {
  const original: PyramidImage = {
    width: 32,
    height: 24,
    pixels: Array.from({ length: 32 * 24 }, (_, i) => {
      const x = i % 32,
        y = Math.floor(i / 32)
      if (x >= 6 && x <= 16 && y >= 10 && y <= 15) return x % 2 ? 45 : 230
      if (x >= 3 && x <= 19 && y >= 7 && y <= 20) return 165
      if (Math.hypot(x - 25, y - 7) < 4) return 225
      return 28 + x + y
    })
  }
  const g1 = down(original),
    g2 = down(g1),
    expanded1 = up(g1),
    expanded2 = up(g2)
  const l0 = combine(original, expanded1, -1),
    l1 = combine(g1, expanded2, -1)
  const restored1 = combine(expanded2, l1, 1),
    restored0 = combine(up(restored1), l0, 1)
  return {
    gaussian: [original, g1, g2],
    expanded: [expanded1, expanded2],
    laplacian: [l0, l1],
    enlargedOnly: up(expanded2),
    reconstructed: restored0
  }
}

const draw = (image: PyramidImage, x: number, y: number, width: number, residual = false) => {
  const cell = width / image.width
  return (
    image.pixels
      .map((value, i) => {
        const gray = Math.max(0, Math.min(255, Math.round(value)))
        const amount = Math.min(1, (Math.abs(value) * 3) / 255)
        const colour = value < 0 ? [181, 160, 255] : [99, 226, 189]
        const fill = residual
          ? `rgb(${colour.map((v, i) => Math.round([20, 27, 39][i] + amount * (v - [20, 27, 39][i]))).join(' ')})`
          : `rgb(${gray} ${gray} ${gray})`
        return rect(
          x + (i % image.width) * cell,
          y + Math.floor(i / image.width) * cell,
          cell + 0.02,
          cell + 0.02,
          fill
        )
      })
      .join('') + rect(x, y, width, image.height * cell, 'none', residual ? c.purple : c.grid)
  )
}

/** A worked Gaussian/Laplacian decomposition, including two signed detail bands and exact reconstruction. */
export function pyramidVisual(): Visual {
  const {
    gaussian: [g0, g1, g2],
    expanded: [e1, e2],
    laplacian: [l0, l1],
    enlargedOnly,
    reconstructed
  } = buildPyramidExample()
  const residualRow = (fine: PyramidImage, expanded: PyramidImage, residual: PyramidImage, y: number, k: number) =>
    label(47, y - 8, `G${k}`, c.ink, 'middle') +
    label(160, y - 8, `expand(G${k + 1})`, c.ink, 'middle', 9) +
    label(273, y - 8, `L${k}`, c.purple, 'middle') +
    draw(fine, 3, y, 88) +
    label(103, y + 38, '−', c.orange, 'middle', 19) +
    draw(expanded, 116, y, 88) +
    label(216, y + 38, '=', c.orange, 'middle', 17) +
    draw(residual, 229, y, 88, true)
  return visual(
    shot(
      'Original: broad shapes + fine stripes',
      draw(g0, 32, 16, 256) + label(160, 220, 'G0 · 32 × 24 pixels', c.muted, 'middle', 10),
      'Watch the thin stripes inside the rectangle. Shrinking removes their contrast while the larger shapes remain recognizable.'
    ),
    [
      shot(
        'Gaussian: blur, shrink, repeat',
        label(100, 36, 'G0 · 32 × 24', c.ink, 'middle') +
          draw(g0, 20, 48, 160) +
          label(260, 36, 'G1 · 16 × 12', c.green, 'middle', 10) +
          draw(g1, 220, 48, 80) +
          label(260, 145, 'G2 · 8 × 6', c.green, 'middle', 10) +
          draw(g2, 240, 153, 40) +
          arrow(184, 79, 215, 79) +
          arrow(260, 113, 260, 131) +
          label(160, 216, 'Each step keeps ¼ as many pixels', c.green, 'middle', 10),
        'G0 is the original. pyrDown blurs it and halves both dimensions to make G1, then repeats to make G2. These smaller images form the Gaussian pyramid; the fine stripes fade away.'
      ),
      shot(
        'Laplacian: save the missing detail',
        residualRow(g0, e1, l0, 28, 0) +
          residualRow(g1, e2, l1, 123, 1) +
          label(160, 215, 'mint: add · violet: subtract · dark: zero', c.muted, 'middle', 9),
        'Enlarge the next smaller Gaussian image to the current size, then subtract it from the current image. L0 stores the fine stripes and sharp edges; L1 stores broader corrections. Each row is shown at a common display size. Save G2 as the coarse base.'
      ),
      shot(
        'Rebuild: enlarge, add detail, repeat',
        label(80, 29, 'Enlarge G2 only', c.orange, 'middle', 10) +
          draw(enlargedOnly, 16, 41, 128) +
          label(240, 29, 'Add saved details', c.green, 'middle', 10) +
          draw(reconstructed, 176, 41, 128) +
          label(80, 156, 'stripes stay blurred', c.orange, 'middle', 9) +
          label(240, 156, 'stripes restored', c.green, 'middle', 9) +
          label(160, 182, 'expand(G2) + L1 = G1', c.ink, 'middle', 11) +
          label(160, 207, 'expand(G1) + L0 = G0', c.green, 'middle', 11),
        'Start with the saved G2. Expand it and add L1 to recover G1; expand again and add L0 to recover G0. Enlarging alone leaves a blur. Adding the stored signed detail bands restores every original sample in this floating-point example.'
      )
    ],
    'Computed 32 × 24 example using the OpenCV pyramid kernel, checked against native pyrDown/pyrUp. Detail-band colour is amplified 3× for visibility; the stored values keep their signs and are never clipped.'
  )
}
