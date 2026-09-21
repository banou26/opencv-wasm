import type { Algorithm } from '../../data/algorithms'
import { palette as c, rect, path, dot, label, line, arrow, shot, visual, type Point, type Visual } from './primitives'

const features: Point[] = [
  [80, 70],
  [124, 76],
  [201, 79],
  [231, 113],
  [195, 156],
  [116, 144],
  [74, 159],
  [152, 104]
]
const house = (colour = c.purple) =>
  path(
    'M65 177V99L152 43L247 99V177ZM65 99H247M131 177V126H175V177M83 117H110V144H83ZM198 115H225V144H198Z',
    colour,
    2,
    colour + '12'
  )
const transform = (body: string, tx = 0, ty = 0, angle = 0, scale = 1) =>
  `<g transform="translate(${tx} ${ty}) rotate(${angle} 160 112) translate(160 112) scale(${scale}) translate(-160 -112)">${body}</g>`
const ring = (x: number, y: number, r: number, colour = c.purple) => dot(x, y, r, 'none', colour)
const cloud = (points: Point[], colour = c.purple) =>
  points.map(([x, y], i) => dot(x, y, 3 + (i % 3) * 0.6, colour)).join('')

function homography(): Visual {
  const src: Point[] = [
      [38, 39],
      [274, 39],
      [274, 190],
      [38, 190]
    ],
    project = ([x, y]: Point): Point => {
      const w = 1 + 0.0018 * x
      return [(40 + 0.94 * x - 0.12 * y) / w, (17 + 0.2 * x + 0.88 * y) / w]
    }
  const dst = src.map(project),
    targets = features.map(project),
    wrong: Point[] = [
      [270, 50],
      [263, 179]
    ],
    observations = [...targets.slice(0, 6), ...wrong]
  const plane = (p: Point[], colour = c.purple) => line(p, colour, 2, true, colour + '0e')
  const backdrop = plane(dst, c.muted) + cloud(observations, c.muted)
  const correspondences = features
    .map(([x, y], i) => {
      const [u, v] = observations[i]
      return (
        path(
          `M${x * 0.43 + 6} ${y * 0.8 + 12}L${u * 0.43 + 166} ${v * 0.8 + 12}`,
          i < 6 ? c.purple : c.orange,
          1,
          'none',
          i >= 6
        ) +
        dot(x * 0.43 + 6, y * 0.8 + 12, 3, c.purple) +
        dot(u * 0.43 + 166, v * 0.8 + 12, 3, i < 6 ? c.purple : c.orange)
      )
    })
    .join('')
  const grid = Array.from(
    { length: 7 },
    (_, i) =>
      line([project([38 + (i * 236) / 6, 39]), project([38 + (i * 236) / 6, 190])], c.green, 1) +
      line([project([38, 39 + (i * 151) / 6]), project([274, 39 + (i * 151) / 6])], c.green, 1)
  ).join('')
  return visual(
    shot(
      'Tentative correspondences',
      rect(16, 25, 130, 168, 'none', c.grid) +
        rect(174, 25, 130, 168, 'none', c.grid) +
        correspondences +
        label(78, 215, 'reference', c.muted, 'middle') +
        label(238, 215, 'observed', c.muted, 'middle'),
      'Eight tentative matches include two inconsistent pairs, shown in orange.'
    ),
    [
      shot(
        'A candidate misses the observations',
        backdrop +
          plane(
            src.map(([x, y]) => [x * 0.83 + 4, y * 0.75 + 26]),
            c.purple
          ) +
          label(24, 212, 'violet: candidate · grey: target'),
        'A transform proposed from an unsuitable sample does not align the plane. RANSAC tries additional small samples.'
      ),
      shot(
        'Check reprojection residuals',
        backdrop +
          plane(dst, c.green) +
          targets
            .map(
              ([x, y], i) =>
                ring(x, y, 7, i < 6 ? c.green : c.orange) +
                arrow(x, y, observations[i][0], observations[i][1], i < 6 ? c.green : c.orange)
            )
            .join('') +
          label(24, 212, '6 agree · 2 rejected', c.orange),
        'Project each reference point and compare it with its observed partner. Orange arrows expose the two large residuals; mint rings mark agreeing pairs.'
      ),
      shot(
        'Recover the projective plane',
        grid +
          plane(dst, c.green) +
          cloud(targets.slice(0, 6), c.green) +
          label(24, 212, 'Refit H using the six inliers', c.green),
        'The accepted mapping bends a rectangular grid into perspective. Every grid intersection uses the same projective transform as the inlier points.'
      )
    ]
  )
}

function matching(a: Algorithm): Visual {
  const descriptors = Array.from({ length: 6 }, (_, r) =>
      Array.from({ length: 12 }, (_, i) => ((i * 7 + r * 11) % 13 > 5 ? 1 : 0))
    ),
    query = descriptors[2].map((v, i) => (i === 4 ? 1 - v : v))
  const distances = descriptors.map((row) => row.reduce<number>((s, v, i) => s + Number(v !== query[i]), 0)),
    order = distances.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const bits = (row: number[], y: number, colour: string) =>
    row.map((v, i) => rect(65 + i * 17, y, 14, 14, v ? colour : c.grid, colour + '40', 2)).join('')
  return visual(
    shot(
      'One query, six descriptors',
      bits(query, 24, c.orange) +
        descriptors
          .map((r, i) => bits(r, 60 + i * 24, c.purple) + label(42, 72 + i * 24, `d${i}`, c.muted, 'end'))
          .join(''),
      'A short binary descriptor makes pairwise differences visible. Orange is the query; violet rows are candidates.'
    ),
    [
      shot(
        a.id === 'flann' ? 'Index candidate descriptors' : 'Compare matching positions',
        bits(query, 35, c.orange) +
          bits(descriptors[2], 68, c.purple) +
          query
            .map((v, i) => (v !== descriptors[2][i] ? rect(65 + i * 17, 30, 14, 58, 'none', c.green) : ''))
            .join('') +
          label(160, 130, 'one bit differs', c.green, 'middle') +
          label(
            160,
            165,
            a.id === 'flann' ? 'binary example: LSH-compatible index' : 'binary example: Hamming distance',
            c.muted,
            'middle'
          ),
        'This binary example counts unequal bits. Float descriptors instead need an appropriate numeric distance.'
      ),
      shot(
        'Rank candidate distances',
        order
          .map(
            ({ v, i }, rank) =>
              rect(72, 30 + rank * 28, v * 22, 17, rank === 0 ? c.green : c.purple) +
              label(54, 43 + rank * 28, `d${i}`, c.muted, 'end') +
              label(80 + v * 22, 43 + rank * 28, v, c.ink)
          )
          .join(''),
        'The best candidate has the smallest descriptor distance. Index search can avoid inspecting every candidate for larger collections.'
      ),
      shot(
        'Keep the nearest candidates',
        bits(query, 40, c.orange) +
          order
            .slice(0, 2)
            .map(
              ({ v, i }, rank) =>
                bits(descriptors[i], 90 + rank * 45, rank === 0 ? c.green : c.muted) +
                label(160, 125 + rank * 45, `d${i}: distance ${v}`, rank === 0 ? c.green : c.muted, 'middle')
            )
            .join(''),
        'The best match is evidence of similar appearance. Ambiguity filtering and geometric verification remain separate steps.'
      )
    ]
  )
}

function feature(a: Algorithm): Visual {
  const scene = house(),
    points: Point[] = [
      [65, 99],
      [152, 43],
      [247, 99],
      [131, 126],
      [175, 126],
      [83, 144],
      [225, 144]
    ]
  const oriented = points
    .map(
      ([x, y], i) => ring(x, y, 10 + (i % 3) * 3) + arrow(x, y, x + 15 * Math.cos(i), y + 15 * Math.sin(i), c.orange)
    )
    .join('')
  const detector = ['fast', 'good-features'].includes(a.id)
  const histogram = Array.from({ length: 32 }, (_, i) => {
    const h = 12 + Math.abs(Math.sin(i * 2.1)) * 50
    return rect(29 + (i % 8) * 33, 80 + Math.floor(i / 8) * 35 - h * 0.45, 12, h * 0.45, c.green)
  }).join('')
  const binary = Array.from({ length: 96 }, (_, i) =>
    rect(28 + (i % 16) * 17, 44 + Math.floor(i / 16) * 23, 13, 17, Math.sin(i * 4) > 0 ? c.green : c.grid, 'none', 2)
  ).join('')
  return visual(
    shot(
      'Texture and corners',
      scene,
      'Corners change intensity in more than one direction; a long straight edge is less distinctive.'
    ),
    [
      shot('Find candidate structure', scene + points.map(([x, y]) => ring(x, y, 16, c.orange)).join(''), a.steps[0]),
      shot(
        detector ? 'Score and suppress nearby candidates' : 'Estimate local scale and orientation',
        scene + oriented,
        a.steps[1]
      ),
      shot(
        detector ? 'Retained keypoint locations' : 'A descriptor for one patch',
        detector
          ? scene +
              cloud(
                points.filter((_, i) => i % 2 === 0),
                c.green
              ) +
              label(160, 211, 'locations and scores, not descriptor bits', c.green, 'middle', 10)
          : a.id === 'sift'
            ? histogram + label(160, 211, 'local gradient orientation histograms', c.green, 'middle')
            : binary + label(160, 211, 'illustrative binary intensity comparisons', c.green, 'middle', 10),
        detector
          ? 'Only well-separated strong corners survive. These detector APIs do not produce descriptors.'
          : a.id === 'sift'
            ? 'The vector summarizes local gradient directions. Bars illustrate its structure, not the complete 128-value SIFT descriptor.'
            : 'Patch comparisons turn local appearance into a compact signature. This grid illustrates a binary descriptor, not the complete native output.'
      )
    ]
  )
}

function alignment(a: Algorithm): Visual {
  const isICP = a.id === 'icp',
    target = isICP ? cloud(features, c.muted) : house(c.muted)
  const mapped = ([x, y]: Point, tx: number, ty: number, angle: number, scale: number): Point => {
    const radians = (angle * Math.PI) / 180,
      dx = (x - 160) * scale,
      dy = (y - 112) * scale
    return [
      160 + tx + dx * Math.cos(radians) - dy * Math.sin(radians),
      112 + ty + dx * Math.sin(radians) + dy * Math.cos(radians)
    ]
  }
  if (a.id === 'affine-warp') {
    const output = transform(house(c.green), 16, -4, -14, 0.83)
    return visual(
      shot(
        'Source coordinate frame',
        house(),
        'This example applies a known rotation, scale and translation to the source.'
      ),
      [
        shot(
          'Construct the affine mapping',
          house() +
            arrow(160, 112, 215, 96, c.orange) +
            label(160, 214, 'rotate −14° · scale 0.83 · translate (16, −4)', c.orange, 'middle', 9),
          'The transformation combines a rotation and scale about the image centre with a final translation.'
        ),
        shot(
          'Sample back into the source',
          house(c.muted) +
            output +
            features
              .slice(0, 5)
              .map((p) => arrow(...mapped(p, 16, -4, -14, 0.83), ...p, c.orange))
              .join(''),
          'Orange arrows run from destination positions back to their source locations. Inverse mapping avoids leaving gaps between output samples.'
        ),
        shot(
          'Resampled output',
          output,
          'The output preserves straight lines under this affine transform. Locations outside the source need an explicit border rule.'
        )
      ]
    )
  }
  const initialScale = isICP ? 1 : 0.84,
    nextScale = isICP ? 1 : 0.94
  const correspondences = (tx: number, ty: number, angle: number, scale: number) =>
    features
      .map((p) => {
        const source = mapped(p, tx, ty, angle, scale)
        const nearest = isICP
          ? features.reduce(
              (best, q) =>
                Math.hypot(source[0] - q[0], source[1] - q[1]) < Math.hypot(source[0] - best[0], source[1] - best[1])
                  ? q
                  : best,
              features[0]
            )
          : p
        return arrow(...source, ...nearest, c.orange)
      })
      .join('')
  const shape = isICP ? cloud(features) : house(),
    shifted = transform(shape, 30, 14, 12, initialScale)
  return visual(
    shot(
      'Initial misalignment',
      target + shifted + label(22, 211, 'grey: reference · violet: moving'),
      'Compare the same structure before and after a coordinate transformation.'
    ),
    [
      shot(
        isICP ? 'Associate nearby points' : 'Measure disagreement',
        target +
          shifted +
          (isICP
            ? correspondences(30, 14, 12, initialScale)
            : path('M72 191H274M274 191V92', c.orange, 1.5, 'none', true)),
        a.steps[0]
      ),
      shot(
        'Apply an intermediate update',
        target + transform(shape, 13, 5, 5, nextScale) + correspondences(13, 5, 5, nextScale),
        a.steps[1]
      ),
      shot(
        'Aligned structure',
        target + (isICP ? cloud(features, c.green) : house(c.green)),
        'The mint structure now coincides with the reference in this illustrative convergence. Real alignment can stop at a local optimum.'
      )
    ]
  )
}

function contour(a: Algorithm): Visual {
  const p: Point[] = [
      [62, 173],
      [71, 95],
      [106, 53],
      [159, 46],
      [209, 69],
      [227, 113],
      [176, 120],
      [237, 183],
      [135, 193]
    ],
    region = line(p, c.muted, 1, true, c.purple + '22'),
    hull = [p[0], p[1], p[2], p[3], p[4], p[5], p[7], p[8]],
    centroid: Point = [149, 125]
  const end =
    a.id === 'convex-hull'
      ? line(hull, c.green, 3, true)
      : a.id === 'moments'
        ? dot(...centroid, 6, c.green) +
          arrow(149, 125, 240, 130) +
          arrow(149, 125, 155, 55) +
          ring(149, 125, 51, c.green)
        : line(a.id === 'polygon-approximation' ? p.filter((_, i) => ![1, 4, 8].includes(i)) : p, c.green, 3, true)
  return visual(
    shot(
      'Shape with a concavity',
      region,
      'The inward notch distinguishes the original boundary from its convex hull.'
    ),
    [
      shot(
        a.id === 'moments' ? 'Accumulate region mass' : 'Inspect ordered boundary samples',
        region +
          cloud(p, c.orange) +
          p
            .slice(0, 4)
            .map(([x, y], i) => label(x - 8, y - 9, i, c.orange))
            .join(''),
        a.steps[0]
      ),
      shot(
        a.id === 'moments' ? 'Locate the centroid' : 'Work through the boundary',
        region +
          (a.id === 'moments'
            ? dot(...centroid, 6, c.orange) + path('M149 28V199M32 125H287', c.orange, 1)
            : line(p.slice(0, 6), c.orange, 3) + path('M62 173L227 113', c.green, 1.5, 'none', true)),
        a.steps[1]
      ),
      shot(
        a.id === 'convex-hull'
          ? 'Outer convex envelope'
          : a.id === 'moments'
            ? 'Centroid and principal spread'
            : a.id === 'polygon-approximation'
              ? 'Reduced vertex sequence'
              : 'Closed contour',
        region + end,
        a.id === 'moments'
          ? 'The centroid and axes illustrate geometric descriptors. They summarize the region rather than reproducing every boundary sample.'
          : a.steps[2]
      )
    ]
  )
}

function flow(a: Algorithm): Visual {
  const background = path('M22 170L75 123L119 157L190 105L291 167', c.muted, 2),
    object = rect(85, 68, 64, 72, c.purple + '35', c.purple),
    future = rect(112, 56, 64, 72, 'none', c.muted),
    dense = a.id !== 'optical-flow-lk'
  const vectors = Array.from({ length: dense ? 70 : 8 }, (_, i) => {
    const x = dense ? 35 + (i % 10) * 27 : 95 + (i % 2) * 36,
      y = dense ? 36 + Math.floor(i / 10) * 25 : 80 + Math.floor(i / 2) * 16,
      inside = x >= 85 && x <= 149 && y >= 68 && y <= 140
    return arrow(
      x,
      y,
      x + (inside || !dense ? 27 : 3),
      y + (inside || !dense ? -12 : 0),
      inside || !dense ? c.green : c.muted
    )
  }).join('')
  return visual(
    shot(
      'Two consecutive frames',
      background + object + future + label(24, 210, 'solid: t · outline: t + 1'),
      'The object moves right and upward; most of the background remains still.'
    ),
    [
      shot(
        dense ? 'Inspect local image patches' : 'Select trackable points',
        background +
          object +
          Array.from({ length: 6 }, (_, i) =>
            rect(79 + (i % 3) * 26, 59 + Math.floor(i / 3) * 42, 28, 28, 'none', c.orange)
          ).join(''),
        a.steps[0]
      ),
      shot(
        'Estimate local displacement',
        background + object + future + [85, 113, 141].map((x) => arrow(x, 94, x + 27, 82, c.orange)).join(''),
        a.steps[1]
      ),
      shot(
        dense ? 'Dense displacement field' : 'Sparse point tracks',
        background + future + vectors,
        dense
          ? 'Mint vectors follow the moving object. Grey vectors represent the nearly static background; each vector belongs to an image location.'
          : 'Only selected points receive tracks. A real call also returns status and error; a plausible vector alone does not prove a valid track.'
      )
    ]
  )
}

function tracking(a: Algorithm): Visual {
  const scene = house(c.muted) + rect(168, 80, 44, 68, c.purple + '55', c.purple),
    old = rect(82, 83, 50, 72, 'none', c.orange)
  return visual(
    shot(
      'Target moves in the next frame',
      scene + old + label(22, 211, 'orange: previous box'),
      'The previous position is a starting estimate, not the new target location.'
    ),
    [
      shot('Search around the old position', scene + old + rect(55, 38, 206, 151, 'none', c.purple), a.steps[0]),
      shot(
        'Score candidate positions',
        Array.from({ length: 96 }, (_, i) => {
          const x = i % 12,
            y = Math.floor(i / 12),
            v = Math.exp(-((x - 7) ** 2 + (y - 4) ** 2) / 4)
          return rect(28 + x * 22, 24 + y * 22, 21, 21, `hsl(${268 - v * 105} 65% ${13 + v * 48}%)`)
        }).join('') + ring(193, 123, 17, c.orange),
        'The illustrative response map peaks near the new position. Ambiguous or occluded targets can produce weak or competing peaks.'
      ),
      shot(
        'Update the target box',
        scene +
          rect(164, 75, 53, 79, 'none', c.green) +
          arrow(109, 120, 190, 115) +
          label(22, 211, 'updated location and appearance', c.green),
        a.steps[2]
      )
    ]
  )
}

function nms(): Visual {
  const boxes = [
    [57, 42, 92, 121, 0.94],
    [65, 48, 94, 122, 0.87],
    [50, 37, 91, 123, 0.76],
    [216, 97, 55, 77, 0.83]
  ]
  const draw = (i: number, colour: string) => {
    const [x, y, w, h, score] = boxes[i]
    return rect(x, y, w, h, 'none', colour) + label(x + 4, y + 16, score.toFixed(2), colour)
  }
  return visual(
    shot(
      'Overlapping detections',
      boxes.map((_, i) => draw(i, i === 3 ? c.blue : c.purple)).join(''),
      'Three boxes cover one object; another box covers a separate object.'
    ),
    [
      shot(
        'Sort by confidence',
        [0, 1, 2, 3].map((i) => draw(i, i === 0 ? c.green : c.muted)).join('') +
          label(24, 213, '0.94 is selected first', c.green),
        'The strongest box is considered first. Confidence ordering matters to greedy suppression.'
      ),
      shot(
        'Compare intersection over union',
        draw(0, c.green) +
          draw(1, c.orange) +
          rect(65, 48, 84, 115, c.orange + '40') +
          label(24, 213, 'overlap / union ≈ 0.75', c.orange),
        'The shaded intersection is large relative to the union. At an IoU threshold of 0.5, this neighbour is suppressed.'
      ),
      shot(
        'Two detections remain',
        draw(0, c.green) + draw(3, c.green) + label(24, 213, '4 candidates → 2 kept', c.green),
        'Greedy hard NMS keeps the strongest overlapping box and the separate object. Soft-NMS instead adjusts competing scores.'
      )
    ]
  )
}

function hough(a: Algorithm): Visual {
  const circle = a.id === 'hough-circles',
    p: Point[] = Array.from({ length: 12 }, (_, i) =>
      circle
        ? [155 + 65 * Math.cos((i * Math.PI) / 6), 111 + 65 * Math.sin((i * Math.PI) / 6)]
        : [42 + i * 19, 183 - i * 12]
    )
  const noise: Point[] = [
    [51, 46],
    [258, 168],
    [82, 140],
    [231, 66]
  ]
  const curves = p
    .slice(0, 6)
    .map(([x, y]) =>
      line(
        Array.from({ length: 100 }, (_, i) => {
          const theta = (i / 99) * Math.PI
          return [24 + (i / 99) * 272, 118 - ((x / 3) * Math.cos(theta) + (y / 3) * Math.sin(theta)) * 0.8] as Point
        }),
        c.purple,
        1
      )
    )
    .join('')
  return visual(
    shot('Edge observations', cloud([...p, ...noise]), 'A supported shape is mixed with a few unrelated edge samples.'),
    [
      shot(
        circle ? 'Gradient directions suggest centres' : 'Map points into parameter space',
        circle
          ? cloud(p) +
              p
                .filter((_, i) => i % 2 === 0)
                .map(([x, y]) => arrow(x, y, 155, 111, c.orange))
                .join('')
          : curves + label(25, 211, 'horizontal: θ · vertical: ρ'),
        'Each observation votes for compatible shapes. Agreement accumulates even when the visible boundary has gaps.'
      ),
      shot(
        'Locate concentrated evidence',
        circle
          ? cloud(p, c.muted) + ring(155, 111, 20, c.orange) + dot(155, 111, 7, c.green)
          : curves + ring(111, 71, 15, c.orange) + label(111, 42, 'shared votes', c.orange, 'middle'),
        'A strong accumulator peak identifies a plausible centre or line parameter pair. This view illustrates the voting mechanism.'
      ),
      shot(
        circle ? 'Recover centre and radius' : 'Recover a supported line',
        cloud([...p, ...noise], c.muted) +
          (circle
            ? ring(155, 111, 65, c.green) + arrow(155, 111, 220, 111) + label(177, 101, 'r', c.green)
            : line([p[0], p[11]], c.green, 3)),
        'The recovered geometry follows the consistent observations; isolated samples do not define the final shape.'
      )
    ]
  )
}

function camera(a: Algorithm): Visual {
  if (a.id === 'camera-calibration') {
    const board = Array.from({ length: 35 }, (_, i) =>
      rect(
        49 + (i % 7) * 31,
        33 + Math.floor(i / 7) * 31,
        31,
        31,
        ((i % 7) + Math.floor(i / 7)) % 2 ? c.purple : c.dark
      )
    ).join('')
    const corners: Point[] = Array.from({ length: 24 }, (_, i) => [80 + (i % 6) * 31, 64 + Math.floor(i / 6) * 31])
    return visual(
      shot(
        'Known calibration target in several views',
        `<g transform="translate(2 5) scale(.53)">${board}</g><g transform="translate(161 10) rotate(12 78 55) scale(.5)">${board}</g><g transform="translate(67 99) skewX(-15) scale(.53)">${board}</g>`,
        'Known square spacing ties many observed image points to one target coordinate system.'
      ),
      [
        shot(
          'Detect target corner coordinates',
          board + cloud(corners, c.orange),
          'Interior checkerboard intersections provide repeated point correspondences. Multiple poses constrain the camera parameters.'
        ),
        shot(
          'Reduce reprojection residuals',
          cloud(corners, c.muted) +
            corners
              .map(([x, y], i) => arrow(x + (x - 155) * 0.1, y + (y - 105) * 0.15 + ((i % 3) - 1) * 4, x, y, c.orange))
              .join('') +
            label(160, 213, 'predicted → observed corners', c.orange, 'middle'),
          'The optimizer adjusts intrinsics, distortion and each view’s pose to reduce the distance between predicted and detected points.'
        ),
        shot(
          'Estimate the camera model',
          rect(58, 29, 203, 117, 'none', c.green, 5) +
            [
              ['fₓ', '0', 'cₓ'],
              ['0', 'fᵧ', 'cᵧ'],
              ['0', '0', '1']
            ]
              .map((row, y) => row.map((v, x) => label(98 + x * 62, 59 + y * 35, v, c.green, 'middle', 18)).join(''))
              .join('') +
            label(160, 174, 'intrinsics K + distortion', c.ink, 'middle') +
            label(160, 201, 'and one R, t per view', c.muted, 'middle'),
          'The intrinsic matrix relates camera coordinates to pixels. Distortion parameters and per-view poses complete this illustrative calibration model.'
        )
      ]
    )
  }
  if (a.id === 'pnp') {
    const vertices = Array.from({ length: 8 }, (_, i) => [i & 1 ? 0.8 : -0.8, i & 2 ? 0.8 : -0.8, i & 4 ? 0.8 : -0.8])
    const project = (yaw: number, tx: number) =>
      vertices.map(([x, y, z]) => {
        const X = Math.cos(yaw) * x + Math.sin(yaw) * z + tx,
          Z = -Math.sin(yaw) * x + Math.cos(yaw) * z + 4
        return [160 + (180 * X) / Z, 108 + (180 * y) / Z] as Point
      })
    const observed = project(0.65, 0.1),
      guess = project(0.15, -0.45),
      edges = vertices.flatMap((_, i) => [1, 2, 4].flatMap((bit) => (i & bit ? [] : [[i, i | bit]])))
    const cube = (p: Point[], colour: string) => edges.map(([i, j]) => line([p[i], p[j]], colour, 1.8)).join('')
    return visual(
      shot(
        'Known 3D object geometry',
        cube(project(-0.65, 0), c.purple) + label(160, 211, 'eight known object-space corners', c.muted, 'middle', 10),
        'The shape is known in object coordinates. One calibrated camera sees it at an unknown pose.'
      ),
      [
        shot(
          'Match model corners to image points',
          cloud(observed, c.orange) +
            observed.map(([x, y], i) => label(x + 7, y - 5, i, c.orange)).join('') +
            rect(24, 20, 272, 175, 'none', c.muted),
          'The numbered 2D observations correspond to the eight known 3D vertices. Point order must agree between the two arrays.'
        ),
        shot(
          'Fit rotation and translation',
          cube(guess, c.purple) +
            cloud(observed, c.muted) +
            guess.map((p, i) => arrow(...p, ...observed[i], c.orange)).join(''),
          'The trial pose projects the cube to the wrong locations. Orange residuals point from predictions to observations.'
        ),
        shot(
          'Reproject using the recovered pose',
          cube(observed, c.green) +
            cloud(observed, c.green) +
            arrow(160, 108, 208, 125, c.orange) +
            arrow(160, 108, 160, 58, c.blue) +
            label(160, 211, 'object pose relative to one camera: R, t', c.green, 'middle', 10),
          'The final illustrative pose projects the model onto the observed points. A native PnP result must still be checked for depth and reprojection error.'
        )
      ]
    )
  }
  if (a.id === 'undistortion') {
    const grid = (bend: number) =>
      Array.from(
        { length: 9 },
        (_, i) =>
          line(
            Array.from({ length: 25 }, (_, j) => {
              const x = 40 + i * 30,
                y = 24 + j * 7
              return [x + bend * ((x - 160) / 120) * ((y - 108) / 84) ** 2, y] as Point
            }),
            c.purple,
            1.5
          ) +
          line(
            Array.from({ length: 25 }, (_, j) => {
              const y = 28 + i * 21,
                x = 36 + j * 10
              return [x, y + bend * ((y - 112) / 90) * ((x - 156) / 120) ** 2] as Point
            }),
            c.purple,
            1.5
          )
      ).join('')
    return visual(
      shot('Lens-distorted grid', grid(22), 'Straight scene lines appear curved under radial lens distortion.'),
      [
        shot(
          'Use a calibrated lens model',
          grid(22) + ring(160, 112, 62, c.orange) + dot(160, 112, 4, c.orange),
          'The distortion centre and radial terms define the correction map.'
        ),
        shot(
          'Build inverse sampling coordinates',
          grid(10) + [60, 110, 210, 260].map((x) => arrow(x, 45, x + (160 - x) * 0.1, 52)).join(''),
          'For each corrected pixel, look up where its value came from in the distorted image.'
        ),
        shot(
          'Remap to a straight grid',
          grid(0),
          'Sampling through the inverse map straightens the grid. Border coverage depends on the chosen output camera.'
        )
      ]
    )
  }
  const cameras = path('M46 175L29 200H79ZM266 175L241 200H291Z', c.purple, 2, c.purple + '22'),
    point: Point = [168, 40],
    rays = line([[54, 179], point, [266, 179]], c.muted, 1),
    planes = path('M75 109H133M206 109H269', c.orange, 3)
  const disparity = ['stereo-bm', 'stereo-sgbm'].includes(a.id)
  return visual(
    shot(
      disparity ? 'Rectified stereo observations' : 'Scene and camera observations',
      cameras +
        rays +
        planes +
        dot(...point, 6, c.purple) +
        label(54, 217, 'left camera', c.muted, 'middle', 10) +
        label(266, 217, 'right camera', c.muted, 'middle', 10),
      'Two cameras observe the same scene point from different positions.'
    ),
    [
      shot(
        disparity ? 'Compare along a scanline' : 'Connect scene points to observations',
        cameras +
          rays +
          planes +
          dot(111, 109, 5, c.orange) +
          dot(217, 109, 5, c.orange) +
          path('M68 109H276', c.green, 1, 'none', true),
        a.steps[0]
      ),
      shot(
        disparity ? 'Choose a supported horizontal shift' : 'Constrain the geometry',
        disparity
          ? Array.from({ length: 14 }, (_, i) =>
              rect(30 + i * 19, 184 - (25 + (i - 6) ** 2 * 2), 13, 25 + (i - 6) ** 2 * 2, i === 6 ? c.green : c.purple)
            ).join('') + label(160, 210, 'matching cost by candidate disparity', c.muted, 'middle', 10)
          : cameras +
              planes +
              line([[54, 179], point], c.green, 2) +
              line([[266, 179], point], c.orange, 2) +
              ring(...point, 13, c.green),
        a.steps[1]
      ),
      shot(
        disparity
          ? 'Disparity indicates relative depth'
          : a.id === 'camera-calibration'
            ? 'Estimate intrinsics and view poses'
            : a.id === 'pnp'
              ? 'Recover the object pose'
              : a.id === 'epipolar-geometry'
                ? 'Constrain the partner observation'
                : 'Reconstruct the scene point',
        disparity
          ? Array.from({ length: 168 }, (_, i) => {
              const x = i % 14,
                y = Math.floor(i / 14),
                v = x > 4 && x < 10 && y > 2 && y < 10
              return rect(34 + x * 18, 18 + y * 16, 18, 16, v ? c.green : c.purple + '55')
            }).join('') + label(160, 218, 'larger disparity → closer surface', c.green, 'middle', 10)
          : a.id === 'epipolar-geometry'
            ? cameras +
              path('M75 109H133M178 109H290', c.green, 3) +
              dot(111, 109, 5, c.orange) +
              label(160, 43, 'partner lies on an epipolar line', c.green, 'middle', 10)
            : cameras +
              line([[54, 179], point, [266, 179]], c.green, 2) +
              dot(...point, 7, c.green) +
              arrow(...point, 220, 48) +
              arrow(...point, 166, 17) +
              label(
                176,
                75,
                a.id === 'camera-calibration' ? 'K, distortion, poses' : a.id === 'pnp' ? 'R, t' : 'X, Y, Z',
                c.green
              ),
        a.steps[2]
      )
    ]
  )
}

function resampling(a: Algorithm): Visual {
  const values = [30, 80, 170, 230],
    cells = values
      .map(
        (v, i) =>
          rect(56 + (i % 2) * 100, 25 + Math.floor(i / 2) * 85, 98, 83, `rgb(${v} ${v} ${v})`) +
          label(106 + (i % 2) * 100, 68 + Math.floor(i / 2) * 85, v, v > 130 ? c.dark : c.ink, 'middle', 17)
      )
      .join(''),
    value = 0.75 * 0.4 * 30 + 0.25 * 0.4 * 80 + 0.75 * 0.6 * 170 + 0.25 * 0.6 * 230
  return visual(
    shot('Four neighbouring source samples', cells, 'A magnified patch makes the interpolation arithmetic visible.'),
    [
      shot(
        'Map a destination centre back',
        cells + dot(131, 119, 6, c.orange) + path('M131 25V195M56 119H256', c.orange, 1, 'none', true),
        a.id === 'remap'
          ? 'An arbitrary coordinate map requests this fractional source location.'
          : 'This destination pixel falls at fractional offsets dx = 0.25 and dy = 0.60 between source centres.'
      ),
      shot(
        'Compute bilinear weights',
        [0.3, 0.1, 0.45, 0.15]
          .map(
            (v, i) =>
              rect(56 + (i % 2) * 100, 25 + Math.floor(i / 2) * 85, 98, 83, c.green + '20', c.green) +
              label(106 + (i % 2) * 100, 70 + Math.floor(i / 2) * 85, v.toFixed(2), c.green, 'middle', 20)
          )
          .join(''),
        'The four weights sum to one. Nearer samples contribute more along each axis.'
      ),
      shot(
        'Interpolate one destination value',
        rect(86, 38, 148, 148, `rgb(${value} ${value} ${value})`, c.green, 5) +
          label(160, 115, value.toFixed(1), c.ink, 'middle', 29) +
          label(160, 213, '9 + 8 + 76.5 + 34.5 = 128', c.green, 'middle'),
        'Repeat the mapping and interpolation for every destination pixel. Other interpolation flags use different sampling rules.'
      )
    ]
  )
}

/** Geometric teaching scenes with explicit changing observations, estimates and results. */
export function geometryVisual(a: Algorithm): Visual | undefined {
  if (a.id === 'homography') return homography()
  if (a.diagram === 'matching') return matching(a)
  if (a.diagram === 'features') return feature(a)
  if (['warp', 'ecc'].includes(a.diagram)) return alignment(a)
  if (['contour', 'shape'].includes(a.diagram)) return contour(a)
  if (a.diagram === 'flow') return flow(a)
  if (a.diagram === 'tracking') return tracking(a)
  if (a.id === 'nms') return nms()
  if (a.diagram === 'hough') return hough(a)
  if (['camera', 'stereo'].includes(a.diagram)) return camera(a)
  if (a.diagram === 'resampling') return resampling(a)
}
