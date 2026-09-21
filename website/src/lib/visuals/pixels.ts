import type { Algorithm } from '../../data/algorithms'
import { palette as c, rect, path, dot, label, shot, visual, type Visual } from './primitives'

const W = 24,
  H = 16
const clamp = (v: number, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, v))
const field = (fn: (x: number, y: number) => number) =>
  Array.from({ length: W * H }, (_, i) => fn(i % W, Math.floor(i / W)))
const at = (a: number[], x: number, y: number) => a[clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)]
const offsets = Array.from({ length: 9 }, (_, i) => [(i % 3) - 1, Math.floor(i / 3) - 1])
const neighbours = (a: number[], x: number, y: number) => offsets.map(([dx, dy]) => at(a, x + dx, y + dy))
const clean = field(
  (x, y) => 35 + x * 2 + (x > 4 && x < 13 && y > 3 && y < 12 ? 115 : 0) + (Math.hypot(x - 18, y - 7) < 3.5 ? 150 : 0)
)
const noisy = clean.map((v, i) => clamp(v + Math.sin(i * 17.3) * 28 + (i % 43 === 0 ? 95 : 0)))
const gray = (v: number) => `rgb(${Math.round(clamp(v))} ${Math.round(clamp(v))} ${Math.round(clamp(v))})`
const heat = (v: number) => `hsl(${270 - clamp(v) * 0.45} 70% ${12 + clamp(v) * 0.24}%)`
const raster = (a: number[], colour = gray) =>
  a.map((v, i) => rect(16 + (i % W) * 12, 16 + Math.floor(i / W) * 12, 12.05, 12.05, colour(v))).join('')
const windowBox = (x = 10, y = 7) =>
  rect(16 + (x - 1) * 12, 16 + (y - 1) * 12, 36, 36, 'none', c.orange) + dot(22 + x * 12, 22 + y * 12, 3, c.orange)
const convolution = (a: number[], kernel: number[], divisor = 1) =>
  field((x, y) => neighbours(a, x, y).reduce((sum, v, i) => sum + v * kernel[i], 0) / divisor)
const gaussian = (a: number[]) => convolution(a, [1, 2, 1, 2, 4, 2, 1, 2, 1], 16)
const partial = (a: number[], b: number[]) => a.map((v, i) => (i % W < 12 ? b[i] : v))
const sweep = () =>
  path('M160 16V208', c.orange, 2) + label(24, 32, 'processed', c.green) + label(292, 32, 'pending', c.orange, 'end')
const input = (
  a: number[],
  title = 'Input image',
  detail = 'The same scene stays here while the working view changes.'
) => shot(title, raster(a), detail)
const computed =
  'Computed teaching example on a 24 × 16 image. Small kernels and simplified settings keep each change visible; use the image laboratory for native OpenCV.'

function filtering(a: Algorithm): Visual {
  let source = noisy,
    out: number[],
    kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1],
    divisor = 16
  let working = 'Weighted neighbourhood',
    explanation = 'Closer neighbours carry more weight; all nine weights sum to 16.'
  if (a.id === 'box-filter') {
    kernel = Array(9).fill(1)
    divisor = 9
    explanation = 'Every sample has the same weight, 1/9.'
  }
  if (a.id === 'filter2d') {
    kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0]
    divisor = 1
    explanation = 'This example uses a sharpening kernel. Positive and negative weights emphasize local contrast.'
  }
  out = convolution(source, kernel, divisor)
  if (a.id === 'median-filter') {
    source = clean.map((v, i) => (i % 19 === 0 ? 255 : i % 29 === 0 ? 0 : v))
    out = field((x, y) => neighbours(source, x, y).sort((p, q) => p - q)[4])
    working = 'Rank the nine samples'
    explanation = 'Salt-and-pepper outliers move to the ends of the sorted window. The middle sample survives.'
  }
  if (a.id === 'bilateral-filter') {
    out = field((x, y) => {
      let sum = 0,
        weights = 0
      offsets.forEach(([dx, dy], i) => {
        const v = at(source, x + dx, y + dy),
          w = kernel[i] * Math.exp(-(((v - at(source, x, y)) / 35) ** 2) / 2)
        sum += v * w
        weights += w
      })
      return sum / weights
    })
    working = 'Weight distance AND intensity'
    explanation =
      'A nearby sample across a strong intensity boundary receives very little weight. The boundary stays sharper.'
  }
  if (a.id === 'guided-filter') {
    const mean = (p: number[]) => convolution(p, Array(9).fill(1), 9),
      I = clean,
      mI = mean(I),
      mp = mean(source),
      corr = mean(I.map((v) => v * v)),
      cross = mean(I.map((v, i) => v * source[i]))
    const alpha = mI.map((v, i) => (cross[i] - v * mp[i]) / (corr[i] - v * v + 100)),
      beta = mp.map((v, i) => v - alpha[i] * mI[i]),
      ma = mean(alpha),
      mb = mean(beta)
    out = I.map((v, i) => ma[i] * v + mb[i])
    working = 'Fit local linear predictions'
    explanation =
      'The clean scene is the guide in this example. Local fits follow its boundaries while smoothing noise in the input.'
  }
  if (a.id === 'nonlocal-means') {
    out = field((x, y) => {
      let sum = 0,
        total = 0
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const distance =
              offsets.reduce(
                (s, [u, v]) => s + (at(source, x + u, y + v) - at(source, x + dx + u, y + dy + v)) ** 2,
                0
              ) / 9,
            weight = Math.exp(-distance / 900)
          sum += weight * at(source, x + dx, y + dy)
          total += weight
        }
      return sum / total
    })
    working = 'Compare patches, then average'
    explanation =
      'A 7 × 7 search compares 3 × 3 patches. Similar neighbourhoods contribute more than visually different patches.'
  }
  const x = 12,
    y = 7,
    values = neighbours(source, x, y),
    value = out[y * W + x]
  const median = a.id === 'median-filter',
    localWeights =
      a.id === 'bilateral-filter'
        ? values.map((v, i) => kernel[i] * Math.exp(-(((v - at(source, x, y)) / 35) ** 2) / 2))
        : kernel
  const weightSum = localWeights.reduce((s, v) => s + v, 0),
    shown = median ? [...values].sort((a, b) => a - b) : values
  const table = shown
    .map((v, i) => {
      const weight =
        a.id === 'bilateral-filter'
          ? `× ${(localWeights[i] / weightSum).toFixed(2)}`
          : a.id === 'guided-filter'
            ? 'guide / signal'
            : a.id === 'nonlocal-means'
              ? 'patch sample'
              : median
                ? i === 4
                  ? 'middle value'
                  : `rank ${i + 1}`
                : `× ${kernel[i]}${divisor === 1 ? '' : ` / ${divisor}`}`
      return (
        rect(
          43 + (i % 3) * 79,
          23 + Math.floor(i / 3) * 52,
          75,
          48,
          median && i === 4 ? c.green + '30' : c.dark,
          median && i === 4 ? c.green : c.grid,
          3
        ) +
        label(80 + (i % 3) * 79, 44 + Math.floor(i / 3) * 52, Math.round(v), c.ink, 'middle', 14) +
        label(80 + (i % 3) * 79, 62 + Math.floor(i / 3) * 52, weight, c.orange, 'middle', 9)
      )
    })
    .join('')
  const arithmetic = median
    ? `middle of nine samples = ${value.toFixed(0)}`
    : `${Math.round(source[y * W + x])} → ${value.toFixed(1)} at the highlighted pixel`
  return visual(
    input(source, 'Noisy or uneven image'),
    [
      shot(
        'Inspect one neighbourhood',
        raster(source) + windowBox(x, y),
        `The orange 3 × 3 window surrounds one output location. ${explanation}`
      ),
      shot(
        working,
        table + label(160, 196, arithmetic, c.orange, 'middle', 10),
        `${explanation} One output value is ${value.toFixed(1)}; the window then moves across the image.`
      ),
      shot(
        'Apply the rule at every pixel',
        raster(out),
        `The whole image has now been processed. The highlighted input value ${Math.round(source[y * W + x])} becomes ${value.toFixed(1)}.`
      )
    ],
    computed
  )
}

function edges(a: Algorithm): Visual {
  const source = clean,
    smooth = gaussian(source),
    k = a.id === 'scharr' ? [-3, 0, 3, -10, 0, 10, -3, 0, 3] : [-1, 0, 1, -2, 0, 2, -1, 0, 1]
  const gx = convolution(smooth, k),
    gy = convolution(
      smooth,
      k.map((_, i) => k[(i % 3) * 3 + Math.floor(i / 3)])
    ),
    mag = gx.map((v, i) => Math.hypot(v, gy[i])),
    max = Math.max(...mag)
  const suppressed = field((x, y) => {
    const i = y * W + x,
      angle = ((Math.atan2(gy[i], gx[i]) * 180) / Math.PI + 180) % 180,
      dir = angle < 22.5 || angle >= 157.5 ? [1, 0] : angle < 67.5 ? [1, 1] : angle < 112.5 ? [0, 1] : [-1, 1]
    return mag[i] >= at(mag, x + dir[0], y + dir[1]) && mag[i] >= at(mag, x - dir[0], y - dir[1]) ? mag[i] : 0
  })
  const strong = suppressed.map((v) => (v > max * 0.4 ? 1 : 0)),
    stack = strong.flatMap((v, i) => (v ? [i] : []))
  while (stack.length) {
    const i = stack.pop()!
    for (const [dx, dy] of offsets) {
      const x = (i % W) + dx,
        y = Math.floor(i / W) + dy,
        j = y * W + x
      if (x >= 0 && x < W && y >= 0 && y < H && !strong[j] && suppressed[j] > max * 0.16) {
        strong[j] = 1
        stack.push(j)
      }
    }
  }
  const lap = convolution(source, [0, 1, 0, 1, -4, 1, 0, 1, 0]),
    response = a.id === 'laplacian' ? lap : gx,
    scale = Math.max(...response.map(Math.abs))
  const signed = (v: number) =>
    Math.abs(v) < 1
      ? c.dark
      : v < 0
        ? `hsl(266 75% ${25 + (Math.abs(v) / scale) * 48}%)`
        : `hsl(161 65% ${22 + (v / scale) * 48}%)`
  return visual(
    input(source, 'Intensity image', 'Flat regions and sharp transitions respond very differently.'),
    a.id === 'canny'
      ? [
          shot(
            'Gradient magnitude',
            raster(
              mag.map((v) => (v / max) * 255),
              heat
            ),
            'Smoothing precedes the derivatives. Brighter samples indicate larger local intensity changes.'
          ),
          shot(
            'Thin the responses',
            raster(
              suppressed.map((v) => (v / max) * 255),
              heat
            ),
            'Non-maximum suppression removes responses on either side of a local ridge, leaving a thin candidate boundary.'
          ),
          shot(
            'Link strong and weak edges',
            raster(strong, (v) => (v ? c.green : c.dark)),
            'Hysteresis starts at strong responses and follows connected weak ones. Isolated weak responses disappear.'
          )
        ]
      : [
          shot(
            'Inspect opposite neighbours',
            raster(source) + windowBox(12, 7),
            'The highlighted window straddles an intensity boundary. Flat windows have cancelling contributions.'
          ),
          shot(
            a.id === 'laplacian' ? 'Second derivative response' : 'Signed horizontal response',
            raster(response, signed),
            'Mint is positive; violet is negative. Dark pixels have almost no response. Keep a signed matrix depth to preserve both signs.'
          ),
          shot(
            a.id === 'laplacian' ? 'Response magnitude' : 'Combine x and y',
            raster(
              (a.id === 'laplacian' ? lap.map(Math.abs) : mag).map(
                (v) => (v / (a.id === 'laplacian' ? scale : max)) * 255
              ),
              heat
            ),
            'Magnitude makes transitions visible regardless of sign. Display normalization is applied only to this illustration.'
          )
        ],
    computed
  )
}

function thresholds(a: Algorithm): Visual {
  const source = field((x, y) => 35 + x * 5 + (x > 4 && x < 20 && y > 4 && y < 12 ? 65 : 0)),
    local = convolution(source, Array(9).fill(1), 9)
  const out = source.map((v, i) =>
    a.id === 'adaptive-threshold' ? v > local[i] - 5 : a.id === 'in-range' ? v >= 100 && v <= 170 : v > 128
  )
  const count = out.filter(Boolean).length
  const bars = Array(16).fill(0)
  source.forEach((v) => bars[Math.min(15, Math.floor(v / 16))]++)
  return visual(
    input(source, 'Object under uneven lighting'),
    [
      shot(
        a.id === 'adaptive-threshold' ? 'Compute a local reference' : 'Inspect intensity distribution',
        a.id === 'adaptive-threshold'
          ? raster(local) + windowBox()
          : bars.map((v, i) => rect(24 + i * 17, 185 - v * 2, 13, v * 2, i < 8 ? c.purple : c.green)).join('') +
              (a.id === 'in-range'
                ? rect(130.25, 32, 74.375, 158, c.orange + '15', c.orange) +
                  label(167, 28, '100 ≤ I ≤ 170', c.orange, 'middle')
                : path('M160 32V190', c.orange) + label(164, 28, 'T = 128', c.orange)),
        'Different parts of the object have different intensities because the illumination changes across the image.'
      ),
      shot(
        'Evaluate the selection rule',
        raster(source.map((v, i) => (i % W < 12 ? (out[i] ? 255 : 0) : v))) + sweep(),
        a.id === 'adaptive-threshold'
          ? 'Each pixel uses its own local mean minus C = 5.'
          : a.id === 'in-range'
            ? 'Keep intensities in the inclusive interval [100, 170]. This example has one channel; all channels must pass for a colour image.'
            : 'This binary example keeps pixels strictly greater than 128.'
      ),
      shot(
        'Binary selection mask',
        raster(out.map(Number), (v) => (v ? c.green : c.dark)),
        `${count} of ${W * H} pixels pass the rule. The mask records membership, not the original brightness.`
      )
    ],
    computed
  )
}

const mask = field((x, y) =>
  Number(
    (x >= 4 && x <= 12 && y >= 3 && y <= 12 && !(x >= 9 && y < 7)) ||
      Math.hypot(x - 18, y - 8) < 3 ||
      (x === 19 && y === 2)
  )
)
const morph = (a: number[], erode: boolean) =>
  field((x, y) =>
    Number(
      offsets[erode ? 'every' : 'some'](
        ([dx, dy]) => x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H && a[(y + dy) * W + x + dx] > 0
      )
    )
  )
const binary = (a: number[], colour = c.purple) => raster(a, (v) => (v ? colour : c.dark))
function thin(a: number[]) {
  const out = [...a]
  for (let iteration = 0; iteration < 24; iteration++) {
    let changed = false
    for (let pass = 0; pass < 2; pass++) {
      const remove: number[] = []
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x
          if (!out[i]) continue
          const p = [
              [0, -1],
              [1, -1],
              [1, 0],
              [1, 1],
              [0, 1],
              [-1, 1],
              [-1, 0],
              [-1, -1]
            ].map(([u, v]) => out[(y + v) * W + x + u]),
            n = p.reduce((s, v) => s + v, 0),
            transitions = p.filter((v, j) => !v && p[(j + 1) % 8]).length
          if (
            n >= 2 &&
            n <= 6 &&
            transitions === 1 &&
            (pass === 0
              ? p[0] * p[2] * p[4] === 0 && p[2] * p[4] * p[6] === 0
              : p[0] * p[2] * p[6] === 0 && p[0] * p[4] * p[6] === 0)
          )
            remove.push(i)
        }
      remove.forEach((i) => {
        out[i] = 0
        changed = true
      })
    }
    if (!changed) break
  }
  return out
}
function regions(a: Algorithm): Visual {
  const eroded = morph(mask, true),
    dilated = morph(mask, false),
    opened = morph(eroded, false)
  let out = a.id === 'erosion' ? eroded : a.id === 'dilation' ? dilated : a.id === 'thinning' ? thin(mask) : opened
  let middle = eroded,
    title = 'Shrink, then expand',
    detail = 'Opening first erodes the region, then dilates the survivors. The isolated speck disappears.'
  if (a.id === 'erosion') {
    middle = partial(mask, out)
    title = 'Require all nine neighbours'
    detail = 'A foreground pixel survives only if the entire 3 × 3 footprint is foreground.'
  }
  if (a.id === 'dilation') {
    middle = partial(mask, out)
    title = 'Accept any foreground neighbour'
    detail = 'The 3 × 3 footprint expands the foreground by one pixel on each side.'
  }
  if (a.id === 'thinning') {
    middle = mask.map((v, i) => (v && !eroded[i] ? 2 : v))
    title = 'Identify removable boundary pixels'
    detail =
      'Zhang-Suen sub-iterations remove boundary pixels while preserving connectivity. The final skeleton is computed from this mask.'
  }
  if (a.diagram === 'distance') {
    const zeros = mask.flatMap((v, i) => (v ? [] : [[i % W, Math.floor(i / W)]]))
    out = field((x, y) => (mask[y * W + x] ? Math.min(...zeros.map(([u, v]) => Math.hypot(x - u, y - v))) : 0))
    return visual(
      shot('Binary foreground', binary(mask), 'Zero-valued pixels are the distance sources.'),
      [
        shot(
          'Locate the boundary',
          raster(
            mask.map((v, i) => (v && !eroded[i] ? 1 : 0)),
            (v) => (v ? c.orange : c.dark)
          ),
          'The first layer of foreground touches zero-valued background.'
        ),
        shot(
          'Grow distance bands',
          raster(out, (v) => (v === 0 ? c.dark : v <= 1 ? c.green : v <= 2 ? c.purple : c.orange)),
          'Each band groups pixels by distance to the nearest zero sample. This example uses exact Euclidean distances.'
        ),
        shot(
          'Euclidean distance field',
          raster(out, (v) => (v ? heat((v / 4) * 255) : c.dark)) +
            label(24, 32, `maximum ${Math.max(...out).toFixed(2)} px`, c.ink),
          'Interior pixels are farther from the background and appear brighter. The isolated speck has distance one.'
        )
      ],
      computed
    )
  }
  if (a.id === 'connected-components') {
    const labels = mask.map(() => 0)
    let count = 0
    for (let i = 0; i < mask.length; i++)
      if (mask[i] && !labels[i]) {
        count++
        const stack = [i]
        labels[i] = count
        while (stack.length) {
          const p = stack.pop()!
          for (const [dx, dy] of offsets) {
            const x = (p % W) + dx,
              y = Math.floor(p / W) + dy,
              j = y * W + x
            if (x >= 0 && x < W && y >= 0 && y < H && mask[j] && !labels[j]) {
              labels[j] = count
              stack.push(j)
            }
          }
        }
      }
    const colours = [c.dark, c.orange, c.green, c.purple]
    return visual(
      shot('Unlabelled mask', binary(mask), 'All foreground pixels initially have the same value.'),
      [
        shot(
          'Find a foreground seed',
          binary(mask) + dot(250, 46, 10, 'none', c.orange),
          'Start a flood from the first unvisited foreground pixel.'
        ),
        shot(
          'Visit connected neighbours',
          raster(labels, (v) => (v <= 2 ? colours[v] : c.muted)),
          'After the speck, the larger L-shaped component receives a different label. Connectivity is eight-neighbour here.'
        ),
        shot(
          `${count} separate components`,
          raster(labels, (v) => colours[v]) +
            [1, 2, 3]
              .map((v) => {
                const ids = labels.flatMap((x, i) => (x === v ? [i] : [])),
                  cx = ids.reduce((s, i) => s + (i % W), 0) / ids.length,
                  cy = ids.reduce((s, i) => s + Math.floor(i / W), 0) / ids.length
                return (
                  dot(22 + cx * 12, 22 + cy * 12, 9, c.dark) + label(22 + cx * 12, 26 + cy * 12, v, c.ink, 'middle')
                )
              })
              .join(''),
          'Colours represent integer labels. Numbered centroids come from each component’s actual pixel coordinates.'
        )
      ],
      computed
    )
  }
  return visual(
    shot(
      'Binary mask',
      binary(mask),
      'Two objects and a single-pixel speck make growth, shrinkage and cleanup easy to compare.'
    ),
    [
      shot(
        'Inspect the 3 × 3 footprint',
        binary(mask) + windowBox(4, 7),
        'The orange window straddles the object boundary. Its covered pixels determine the new centre value.'
      ),
      shot(
        title,
        raster(middle, (v) => (v === 2 ? c.orange : v ? c.green : c.dark)),
        detail
      ),
      shot(
        'Changed foreground',
        binary(out, c.green),
        `${mask.filter(Boolean).length} foreground pixels become ${out.filter(Boolean).length}. ${detail}`
      )
    ],
    computed
  )
}

function segmentation(a: Algorithm): Visual {
  const source = clean
  if (a.id === 'watershed') {
    const object = field((x, y) => Number(Math.min(Math.hypot(x - 9, y - 8), Math.hypot(x - 15, y - 8)) < 5.3))
    const seeds =
      dot(130, 118, 5, c.green) +
      label(130, 105, '1', c.green, 'middle') +
      dot(202, 118, 5, c.purple) +
      label(202, 105, '2', c.purple, 'middle') +
      dot(34, 34, 4, c.blue)
    const regions = field((x, y) => (object[y * W + x] ? (x === 12 ? -1 : x < 12 ? 1 : 2) : 0))
    const paint = (v: number) => (v === -1 ? c.orange : v === 1 ? c.green : v === 2 ? c.purple : c.dark)
    return visual(
      input(
        object.map((v) => (v ? 195 : 40)),
        'Two touching objects',
        'Their binary foreground is connected, but two separate seeds can guide a split.'
      ),
      [
        shot(
          'Place foreground and background markers',
          raster(object.map((v) => (v ? 135 : 30))) + seeds,
          'Mint and violet label separate objects. Blue supplies a background marker; unassigned locations begin as unknown.'
        ),
        shot(
          'Expand competing regions',
          raster(
            field((x, y) => (Math.hypot(x - 9, y - 8) < 3.5 ? 1 : Math.hypot(x - 15, y - 8) < 3.5 ? 2 : 0)),
            paint
          ) + seeds,
          'The coloured fronts expand through the unknown area. This schematic uses symmetric fronts to expose where they meet.'
        ),
        shot(
          'Keep a boundary where regions meet',
          raster(regions, paint) + label(160, 215, 'orange: watershed boundary (−1)', c.orange, 'middle', 10),
          'The orange meeting line separates the labels. In OpenCV, image contrast governs the expansion and meeting boundaries are written as −1.'
        )
      ]
    )
  }
  if (a.id === 'superpixels') {
    let centres = Array.from({ length: 24 }, (_, i) => ({
      x: 2 + (i % 6) * 4,
      y: 2 + Math.floor(i / 6) * 4,
      v: at(source, 2 + (i % 6) * 4, 2 + Math.floor(i / 6) * 4)
    }))
    const assign = () =>
      field((x, y) => {
        let best = 0,
          cost = Infinity
        centres.forEach((p, i) => {
          const d = ((x - p.x) ** 2 + (y - p.y) ** 2) / 16 + ((at(source, x, y) - p.v) / 45) ** 2
          if (d < cost) {
            cost = d
            best = i
          }
        })
        return best
      })
    const initial = assign(),
      seedDrawing = centres.map((p) => dot(22 + p.x * 12, 22 + p.y * 12, 3, c.orange)).join('')
    let labels = initial
    for (let iteration = 0; iteration < 5; iteration++) {
      centres = centres.map((p, k) => {
        const ids = labels.flatMap((v, i) => (v === k ? [i] : []))
        return ids.length
          ? {
              x: ids.reduce((s, i) => s + (i % W), 0) / ids.length,
              y: ids.reduce((s, i) => s + Math.floor(i / W), 0) / ids.length,
              v: ids.reduce((s, i) => s + source[i], 0) / ids.length
            }
          : p
      })
      labels = assign()
    }
    const boundaries = labels
      .map((v, i) => {
        const x = i % W,
          y = Math.floor(i / W)
        return (
          (x < W - 1 && labels[i + 1] !== v ? path(`M${28 + x * 12} ${16 + y * 12}v12`, c.green, 1.4) : '') +
          (y < H - 1 && labels[i + W] !== v ? path(`M${16 + x * 12} ${28 + y * 12}h12`, c.green, 1.4) : '')
        )
      })
      .join('')
    return visual(
      input(source, 'Image with local structure'),
      [
        shot(
          'Place spatially distributed centres',
          raster(source) + seedDrawing,
          'Each centre starts with a position and the intensity at that position.'
        ),
        shot(
          'Assign by appearance and position',
          raster(initial, (v) => `hsl(${(v * 137.5) % 360} 52% 58%)`),
          'The displayed assignments minimize a combined spatial and intensity distance, rather than position alone.'
        ),
        shot(
          'Refine image-aware boundaries',
          raster(source) + boundaries,
          'Five assignment/mean updates bend regions toward the object boundaries. This colour-spatial clustering example omits native connectivity cleanup.'
        )
      ],
      'Computed colour-spatial clustering example. SLIC, SEEDS and LSC use different optimization and connectivity rules.'
    )
  }
  if (a.id === 'grabcut')
    return visual(input(source, 'Object inside a selection rectangle'), [
      shot(
        'Initialize probable foreground',
        raster(source) + rect(63, 51, 116, 120, 'none', c.orange),
        'The rectangle encloses the intended object. Pixels outside it start as definite background.'
      ),
      shot(
        'Fit foreground and background appearance',
        Array.from({ length: 32 }, (_, i) => {
          const x = 25 + i * 8.5,
            h1 = 120 * Math.exp(-(((i - 7) / 3.5) ** 2)),
            h2 = 135 * Math.exp(-(((i - 22) / 3) ** 2))
          return rect(x, 186 - h1, 5, h1, c.purple) + rect(x + 3, 186 - h2, 5, h2, c.green)
        }).join('') +
          label(45, 211, 'background', c.purple) +
          label(208, 211, 'foreground', c.green),
        'The two illustrative distributions summarize different appearances. Native GrabCut fits colour mixtures and combines their likelihoods with neighbourhood smoothness.'
      ),
      shot(
        'Cut away probable background',
        raster(
          field((x, y) => (x > 4 && x < 13 && y > 3 && y < 12 ? 1 : 0)),
          (v) => (v ? c.green : c.dark)
        ),
        'The illustrative cut retains the selected object and removes surrounding pixels inside the rectangle. User labels can correct mistakes before another iteration.'
      )
    ])
  if (a.id === 'mser') {
    const selected = (threshold: number) => source.map((v) => (v > threshold ? 1 : 0)),
      areas = [115, 125, 135, 145, 155, 165, 175, 185].map((t) => selected(t).filter(Boolean).length)
    return visual(input(source, 'Intensity-defined regions'), [
      shot(
        'Sweep an intensity threshold',
        binary(selected(115), c.purple),
        'At this threshold, both bright objects belong to extremal regions.'
      ),
      shot(
        'Track region area across thresholds',
        areas
          .map((area, i) => rect(35 + i * 32, 188 - area * 0.9, 22, area * 0.9, i < 4 ? c.green : c.orange))
          .join('') + label(160, 214, 'threshold increases →', c.muted, 'middle'),
        'The bars show total bright-region area for eight thresholds in this small image. Native MSER tracks individual component histories.'
      ),
      shot(
        'Retain a stable region',
        raster(source) +
          rect(68, 56, 96, 96, 'none', c.green) +
          label(160, 215, 'a plateau indicates stable support', c.green, 'middle'),
        'The outlined object changes little over a range of thresholds. Stability is about persistence across intensity levels, not a semantic object class.'
      )
    ])
  }
  if (a.id === 'alpha-matting') {
    const alpha = field((x, y) => clamp((4 - Math.hypot(x - 12, y - 8)) / 1.8, 0, 1)),
      trimap = alpha.map((v) => (v === 0 ? 0 : v === 1 ? 255 : 128))
    return visual(
      input(
        trimap,
        'Foreground / unknown / background',
        'White is known foreground, black is background, and grey is the unknown band.'
      ),
      [
        shot(
          'Inspect the unknown band',
          raster(trimap, (v) => (v === 128 ? c.orange : gray(v))),
          'Only the unknown band needs fractional coverage estimates.'
        ),
        shot(
          'Resolve soft coverage',
          raster(alpha.map((v) => v * 255)),
          'This radial example illustrates a soft alpha ramp through the unknown band, not a computed matting solution.'
        ),
        shot(
          'Composite with a new background',
          raster(
            alpha,
            (v) => `rgb(${Math.round(35 + 185 * v)} ${Math.round(65 + 145 * v)} ${Math.round(105 + 95 * v)})`
          ),
          'Fractional alpha mixes foreground and background instead of producing a hard binary cut.'
        )
      ]
    )
  }
  const response = field((x, y) => Math.exp(-((x - 18) ** 2 + (y - 7) ** 2) / 14) * 255)
  return visual(input(source, 'Objects with different contrast'), [
    shot(
      'Inspect contrast with the surroundings',
      raster(source) + rect(184, 40, 108, 132, 'none', c.orange),
      a.steps[0]
    ),
    shot(
      'Accumulate local prominence',
      raster(response, heat),
      'The illustrative response concentrates around the smaller, brighter object. The chosen saliency method defines the actual scoring rule.'
    ),
    shot(
      'Select a prominent candidate region',
      raster(source) + rect(196, 52, 84, 108, 'none', c.green),
      'Thresholding or ranking the saliency response can propose regions for later processing. Saliency itself does not assign object identities.'
    )
  ])
}

function histograms(a: Algorithm): Visual {
  const source = clean.map((v) => 85 + v * 0.25),
    bins = Array(16).fill(0)
  source.forEach((v) => bins[Math.floor(v / 16)]++)
  let total = 0
  const cdf = bins.map((v) => (total += v) / source.length)
  const equalized = source.map((v) => cdf[Math.floor(v / 16)] * 255)
  const histogram = (values: number[]) =>
    values
      .map((v, i) =>
        rect(
          24 + i * 17,
          190 - (v / Math.max(...bins)) * 145,
          13,
          (v / Math.max(...bins)) * 145,
          i % 2 ? c.purple : c.blue
        )
      )
      .join('')
  if (a.id === 'clahe') {
    const maps: number[][] = []
    let tileBins: number[] = []
    for (let ty = 0; ty < 4; ty++)
      for (let tx = 0; tx < 4; tx++) {
        const bins = Array(16).fill(0)
        for (let y = ty * 4; y < ty * 4 + 4; y++)
          for (let x = tx * 6; x < tx * 6 + 6; x++) bins[Math.floor(source[y * W + x] / 16)]++
        const excess = bins.reduce((s, v) => s + Math.max(0, v - 3), 0)
        if (tx === 1 && ty === 1) tileBins = [...bins]
        let sum = 0
        maps.push(bins.map((v) => ((sum += Math.min(v, 3) + excess / 16) / 24) * 255))
      }
    const excess = tileBins.reduce((s, v) => s + Math.max(0, v - 3), 0) / 16,
      scale = 145 / Math.max(...tileBins)
    const clippedHistogram = tileBins
      .map(
        (v, i) =>
          rect(24 + i * 17, 190 - v * scale, 13, v * scale, c.purple + '20', c.purple) +
          rect(24 + i * 17, 190 - Math.min(v, 3) * scale, 13, Math.min(v, 3) * scale, c.green) +
          rect(24 + i * 17, 190 - (Math.min(v, 3) + excess) * scale, 13, excess * scale, c.orange)
      )
      .join('')
    const out = field((x, y) => {
      const fx = (x + 0.5) / 6 - 0.5,
        fy = (y + 0.5) / 4 - 0.5,
        tx = Math.floor(fx),
        ty = Math.floor(fy),
        dx = fx - tx,
        dy = fy - ty,
        bin = Math.floor(source[y * W + x] / 16),
        get = (u: number, v: number) => maps[clamp(v, 0, 3) * 4 + clamp(u, 0, 3)][bin]
      return (
        (1 - dy) * ((1 - dx) * get(tx, ty) + dx * get(tx + 1, ty)) +
        dy * ((1 - dx) * get(tx, ty + 1) + dx * get(tx + 1, ty + 1))
      )
    })
    return visual(
      input(source, 'Low-contrast image'),
      [
        shot(
          'Divide into local tiles',
          raster(source) +
            [1, 2, 3].map((i) => path(`M${16 + i * 72} 16V208M16 ${16 + i * 48}H304`, c.orange)).join(''),
          'Each 6 × 4 tile gets a 16-bin histogram in this small example.'
        ),
        shot(
          'Clip and redistribute',
          clippedHistogram +
            path(`M24 ${190 - 3 * scale}H295`, c.green, 1.5, 'none', true) +
            label(24, 25, 'violet: original · mint: clipped', c.muted, 'start', 10) +
            label(24, 212, 'orange: redistributed excess', c.orange, 'start', 10),
          'One tile’s bins are capped at three samples. The removed counts spread uniformly across all 16 bins, shown in orange, before forming the cumulative mapping.'
        ),
        shot(
          'Interpolate local mappings',
          raster(out),
          'Four neighbouring tile mappings blend bilinearly. Contrast grows locally without hard tile seams.'
        )
      ],
      computed
    )
  }
  return visual(
    input(source, 'Narrow intensity range'),
    [
      shot(
        'Count the intensity bins',
        histogram(bins) + label(24, 210, 'dark') + label(294, 210, 'bright', c.muted, 'end'),
        'Most samples occupy a small portion of the available intensity range.'
      ),
      shot(
        'Build the cumulative mapping',
        path('M24 24V190H296', c.muted) +
          path(cdf.map((v, i) => `${i ? 'L' : 'M'}${24 + i * 18} ${190 - v * 160}`).join(' '), c.green) +
          label(34, 40, 'cumulative probability', c.green),
        'This teaching example uses the cumulative rank directly; each step adds the next intensity bin.'
      ),
      shot(
        'Redistributed intensities',
        raster(equalized),
        'Applying the monotone mapping stretches the occupied range and makes the objects easier to distinguish.'
      )
    ],
    computed
  )
}

function template(): Visual {
  const tw = 8,
    th = 9,
    sx = 4,
    sy = 3,
    rw = W - tw + 1,
    rh = H - th + 1
  const patch = Array.from({ length: tw * th }, (_, i) => clean[(sy + Math.floor(i / tw)) * W + sx + (i % tw)])
  const costs = Array.from(
    { length: rw * rh },
    (_, i) =>
      patch.reduce(
        (sum, v, j) => sum + (v - clean[(Math.floor(i / rw) + Math.floor(j / tw)) * W + (i % rw) + (j % tw)]) ** 2,
        0
      ) / patch.length
  )
  const best = costs.indexOf(Math.min(...costs)),
    peakX = best % rw,
    peakY = Math.floor(best / rw),
    max = Math.max(...costs)
  const box = (x: number, y: number, colour: string) => rect(16 + x * 12, 16 + y * 12, tw * 12, th * 12, 'none', colour)
  return visual(
    input(clean, 'Search image', 'Find the location of a known 8 × 9 patch within this larger scene.'),
    [
      shot(
        'Choose the template patch',
        patch.map((v, i) => rect(104 + (i % tw) * 14, 45 + Math.floor(i / tw) * 14, 14, 14, gray(v))).join('') +
          label(160, 211, '8 × 9 source samples', c.orange, 'middle'),
        'The template includes an object corner and surrounding background, not just a uniform interior.'
      ),
      shot(
        'Score every valid placement',
        costs
          .map((v, i) => rect(24 + (i % rw) * 16, 42 + Math.floor(i / rw) * 18, 16, 18, heat((1 - v / max) * 255)))
          .join('') +
          rect(24 + peakX * 16, 42 + peakY * 18, 16, 18, 'none', c.orange) +
          label(160, 210, 'brighter = lower squared difference', c.orange, 'middle', 10),
        'Each response compares all template pixels with one candidate patch. This teaching example computes mean squared difference.'
      ),
      shot(
        'Locate the best match',
        raster(clean) +
          box(peakX, peakY, c.green) +
          label(160, 213, `best top-left = (${peakX}, ${peakY}) · error = 0`, c.green, 'middle', 10),
        'The minimum-error response points back to the matching patch in the original image. Correlation-based methods use a different score convention.'
      )
    ],
    computed
  )
}

/** Pixel-domain examples: exact small-array calculations where stated, conceptual region models otherwise. */
export function pixelVisual(a: Algorithm): Visual | undefined {
  if (a.diagram === 'template') return template()
  if (['convolution', 'denoise'].includes(a.diagram)) return filtering(a)
  if (['gradient', 'edges'].includes(a.diagram)) return edges(a)
  if (a.diagram === 'threshold') return thresholds(a)
  if (['morphology', 'distance'].includes(a.diagram) || a.id === 'connected-components') return regions(a)
  if (['segmentation', 'matting'].includes(a.diagram) || a.id === 'superpixels') return segmentation(a)
  if (a.diagram === 'histogram') return histograms(a)
}
