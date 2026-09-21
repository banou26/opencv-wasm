import type { Algorithm } from '../../data/algorithms'
import { palette as c, rect, path, dot, label, line, arrow, shot, visual, type Point, type Visual } from './primitives'

const plot = (values: number[], colour = c.purple, y = 112, scale = 50) =>
  line(
    values.map((v, i) => [24 + (i / (values.length - 1)) * 272, y - v * scale] as Point),
    colour,
    2
  )
const axes = () => path('M24 24V192H297', c.muted, 1)
const tile = (x: number, y: number, size = 12, colour = c.purple) => rect(x, y, size - 1, size - 1, colour)
const scene = (offset = 0, colour = c.purple) =>
  path('M20 182L74 113L133 171L190 94L298 181Z', c.muted, 1.5, c.muted + '18') +
  rect(82 + offset, 78, 49, 86, colour + '35', colour) +
  dot(247, 44, 17, c.orange)
const points: Point[] = Array.from({ length: 45 }, (_, i) => [
  72 + (i % 3) * 84 + Math.sin(i * 7) * 31,
  135 - (i % 3) * 22 + Math.cos(i * 11) * 35
])
const colours = [c.purple, c.green, c.orange]
const cloud = (labels?: number[]) =>
  points.map(([x, y], i) => dot(x, y, 3.5, labels ? colours[labels[i]] : c.muted)).join('')
const centre = ([x, y]: Point, colour: string) =>
  dot(x, y, 10, c.dark, colour) + path(`M${x - 5} ${y}h10m-5-5v10`, colour)

function kalman(): Visual {
  const measurements: Point[] = [
      [34, 165],
      [67, 149],
      [105, 126],
      [135, 123]
    ],
    prediction: Point = [227, 68],
    measurement: Point = [253, 113],
    gain = 0.65,
    corrected: Point = [
      prediction[0] + gain * (measurement[0] - prediction[0]),
      prediction[1] + gain * (measurement[1] - prediction[1])
    ]
  const history = line(measurements, c.muted) + measurements.map(([x, y]) => dot(x, y, 4, c.purple)).join('')
  const ellipse = (x: number, y: number, rx: number, ry: number, colour: string) =>
    `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${colour}12" stroke="${colour}" stroke-dasharray="4 4"/>`
  return visual(
    shot(
      'Noisy observations over time',
      history + dot(...measurement, 5, c.orange) + label(257, 136, 'new z', c.orange),
      'The latest measurement does not lie exactly on the extrapolated motion path.'
    ),
    [
      shot(
        'Predict state and uncertainty',
        history +
          arrow(135, 123, ...prediction, c.purple) +
          ellipse(...prediction, 50, 37, c.purple) +
          dot(...prediction, 5, c.purple),
        'The motion model predicts a location. The broad ellipse illustrates uncertainty after prediction.'
      ),
      shot(
        'Measure the innovation',
        history +
          ellipse(...prediction, 50, 37, c.purple) +
          dot(...prediction, 5, c.purple) +
          dot(...measurement, 5, c.orange) +
          arrow(...prediction, ...measurement, c.orange) +
          label(145, 194, 'innovation = z − predicted observation', c.orange, 'middle', 10),
        'The orange vector is the difference between the measurement and the predicted observation.'
      ),
      shot(
        'Correct with the Kalman gain',
        history +
          dot(...prediction, 4, c.muted) +
          dot(...measurement, 5, c.orange) +
          arrow(...prediction, ...corrected) +
          ellipse(...corrected, 25, 19, c.green) +
          dot(...corrected, 6, c.green) +
          label(160, 205, 'example gain K = 0.65', c.green, 'middle'),
        'The corrected position moves 65% toward the measurement in this scalar-gain example. The smaller ellipse illustrates reduced uncertainty, not a full covariance calculation.'
      )
    ]
  )
}

function polar(a: Algorithm): Visual {
  if (a.id === 'phase-unwrapping') {
    const phase = Array.from({ length: 101 }, (_, i) => (i / 100) * 5 * Math.PI - 0.8),
      wrapped = phase.map((v) => Math.atan2(Math.sin(v), Math.cos(v))),
      unwrap = phase.map((v) => (v / (5 * Math.PI)) * 3 - 1.5)
    return visual(
      shot(
        'Wrapped phase observations',
        axes() + plot(wrapped, c.purple, 112, 24) + label(30, 28, '+π') + label(30, 203, '−π'),
        'Phase is reported modulo a full cycle, so a smooth ramp appears to jump.'
      ),
      [
        shot(
          'Identify cycle discontinuities',
          plot(wrapped, c.purple, 112, 24) +
            [25, 65].map((i) => path(`M${24 + (i / 100) * 272} 29V191`, c.orange, 1.5, 'none', true)).join(''),
          'Neighbouring phase differences near a full cycle are candidates for an integer-cycle correction.'
        ),
        shot(
          'Accumulate whole-cycle offsets',
          axes() +
            plot(
              phase.map((v, i) => (v - wrapped[i]) / (2 * Math.PI)),
              c.orange,
              175,
              45
            ) +
            label(30, 32, 'offset in multiples of 2π', c.orange),
          'The piecewise constant offset records how many complete cycles have been added.'
        ),
        shot(
          'Recover a continuous phase ramp',
          axes() + plot(unwrap, c.green, 112, 49) + label(160, 210, 'φcontinuous = φwrapped + 2πk', c.green, 'middle'),
          'Adding the cycle offsets removes the discontinuities in this noise-free 1D example. Two-dimensional reliability and discontinuities require additional care.'
        )
      ]
    )
  }
  const rings = [28, 53, 78].map((r) => dot(160, 112, r, 'none', c.muted)).join(''),
    shape = path('M160 112L232 71A83 83 0 0 1 239 139Z', c.purple, 2, c.purple + '40')
  return visual(
    shot(
      'Cartesian radius and angle',
      rings + shape + dot(160, 112, 4, c.orange),
      'A bright sector occupies a range of angles and radii around the selected centre.'
    ),
    [
      shot(
        'Choose the common centre',
        rings +
          shape +
          arrow(160, 112, 239, 139, c.orange) +
          label(207, 143, 'r', c.orange) +
          label(181, 91, 'θ', c.orange),
        'Radius is measured from the centre; angle specifies a ray through that centre.'
      ),
      shot(
        'Sample along angular rays',
        rings +
          shape +
          Array.from({ length: 16 }, (_, i) => {
            const angle = (i / 16) * Math.PI * 2
            return path(
              `M160 112L${160 + 82 * Math.cos(angle)} ${112 + 82 * Math.sin(angle)}`,
              i < 2 || i > 14 ? c.green : c.grid,
              1
            )
          }).join(''),
        'Output rows sample different angles. Columns follow radius, or log radius for the logarithmic mode.'
      ),
      shot(
        'Unroll into radius / angle space',
        rect(42, 25, 234, 167, 'none', c.muted) +
          Array.from({ length: 8 }, (_, i) => path(`M${42 + i * 33.4} 25V192M42 ${25 + i * 23.8}H276`, c.grid, 1)).join(
            ''
          ) +
          rect(42, 25, 208, 10, c.green + '70', c.green) +
          rect(42, 178, 208, 14, c.green + '70', c.green) +
          label(160, 213, 'radius →', c.green, 'middle') +
          label(29, 110, 'θ', c.green),
        'The sector crosses angle zero, so its unwrapped samples appear at both ends of the angle axis. A rotation becomes a shift along that axis.'
      )
    ]
  )
}

function frequency(a: Algorithm): Visual {
  const n = 64,
    signal = Array.from(
      { length: n },
      (_, i) => 0.85 * Math.sin((2 * Math.PI * 3 * i) / n) + 0.28 * Math.sin((2 * Math.PI * 12 * i) / n)
    )
  const magnitudes = Array.from({ length: n / 2 }, (_, k) => {
    let re = 0,
      im = 0
    signal.forEach((v, i) => {
      re += v * Math.cos((2 * Math.PI * k * i) / n)
      im -= v * Math.sin((2 * Math.PI * k * i) / n)
    })
    return (Math.hypot(re, im) * 2) / n
  })
  const spectrum =
    magnitudes.map((v, i) => rect(25 + i * 8.6, 188 - v * 159, 6, v * 159, i === 3 ? c.green : c.orange)).join('') +
    label(25, 211, 'frequency bin →')
  if (a.id === 'phase-correlation')
    return visual(
      shot(
        'Two shifted signals',
        plot(signal, c.purple, 91, 31) +
          plot(
            Array.from({ length: n }, (_, i) => signal[(i + n - 7) % n]),
            c.orange,
            159,
            31
          ),
        'Orange is shifted seven samples relative to violet.'
      ),
      [
        shot(
          'Compare Fourier representations',
          axes() + spectrum,
          'A translation changes Fourier phase while preserving the magnitudes in this ideal periodic example.'
        ),
        shot(
          'Normalize the cross-power phase',
          plot(
            Array.from({ length: 64 }, (_, i) => Math.cos((2 * Math.PI * i * 7) / 64)),
            c.green
          ) + label(160, 208, 'unit-magnitude complex phase relation', c.green, 'middle', 10),
          'The normalized product isolates the relative phase; this plot shows the real component for a seven-sample shift.'
        ),
        shot(
          'Locate the correlation peak',
          axes() +
            Array.from({ length: 25 }, (_, i) =>
              rect(25 + i * 10.8, 188 - (i === 7 ? 140 : 2), 7, i === 7 ? 140 : 2, i === 7 ? c.green : c.grid)
            ).join('') +
            label(107, 35, 'shift: +7', c.green),
          'The ideal inverse transform concentrates the response at the displacement. Real images produce a broader, noisy peak.'
        )
      ]
    )
  if (a.id === 'image-hashing')
    return visual(
      shot('Image structure', scene(), 'A perceptual signature retains coarse appearance rather than every pixel.'),
      [
        shot(
          'Normalize image appearance',
          Array.from({ length: 120 }, (_, i) => {
            const x = i % 12,
              y = Math.floor(i / 12)
            return tile(52 + x * 18, 22 + y * 18, 18, x > 2 && x < 7 && y > 2 ? c.purple : c.grid)
          }).join(''),
          'This pHash-style example reduces size and discards fine detail. Other hash algorithms summarize different evidence.'
        ),
        shot(
          'Keep coarse frequency structure',
          spectrum + rect(22, 22, 82, 172, 'none', c.orange),
          'Low-frequency coefficients form a compact description of broad intensity structure.'
        ),
        shot(
          'Compare compact bit signatures',
          Array.from({ length: 64 }, (_, i) =>
            tile(44 + (i % 16) * 15, 53 + Math.floor(i / 16) * 30, 13, i % 5 < 2 ? c.green : c.grid)
          ).join('') + label(160, 210, 'distance counts differing descriptor bits', c.green, 'middle', 10),
          'The displayed bits illustrate a signature, not a hash computed from this drawing. Choose the distance defined by the specific hash API.'
        )
      ]
    )
  if (a.id === 'dct') {
    const coefficients = Array.from(
        { length: n },
        (_, k) =>
          signal.reduce((s, v, i) => s + v * Math.cos((Math.PI * (i + 0.5) * k) / n), 0) *
          (k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n))
      ),
      reconstructed = Array.from({ length: n }, (_, i) =>
        coefficients
          .slice(0, 10)
          .reduce(
            (s, v, k) =>
              s + v * (k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n)) * Math.cos((Math.PI * (i + 0.5) * k) / n),
            0
          )
      )
    return visual(
      shot('Spatial samples', plot(signal), 'A smooth component and a rapid component are mixed together.'),
      [
        shot(
          'Project onto cosine bases',
          [1, 3, 6]
            .map((k, j) =>
              plot(
                Array.from({ length: n }, (_, i) => Math.cos((Math.PI * (i + 0.5) * k) / n)),
                colours[j],
                50 + j * 60,
                22
              )
            )
            .join(''),
          'Each coefficient measures agreement with one cosine basis function.'
        ),
        shot(
          'Retain low-frequency coefficients',
          axes() +
            coefficients
              .slice(0, 32)
              .map((v, i) =>
                rect(25 + i * 8.6, 188 - Math.abs(v) * 30, 6, Math.abs(v) * 30, i < 10 ? c.green : c.muted)
              )
              .join(''),
          'Mint marks the first ten coefficients. Grey coefficients will be discarded in this reconstruction example.'
        ),
        shot(
          'Reconstruct a smoother signal',
          plot(signal, c.muted) + plot(reconstructed, c.green),
          'The inverse cosine transform of the retained coefficients preserves broad variation and loses fine oscillation.'
        )
      ],
      'Computed 64-sample teaching example, separate from the native OpenCV runtime.'
    )
  }
  return visual(
    shot(
      'Mixed spatial frequencies',
      plot(signal),
      'A slow oscillation and a faster ripple are added in the input signal.'
    ),
    [
      shot(
        'Separate basis contributions',
        plot(
          signal.map((_, i) => 0.85 * Math.sin((2 * Math.PI * 3 * i) / n)),
          c.purple,
          74,
          35
        ) +
          plot(
            signal.map((_, i) => 0.28 * Math.sin((2 * Math.PI * 12 * i) / n)),
            c.orange,
            160,
            60
          ),
        'The violet component completes three cycles; orange completes twelve over the same 64 samples.'
      ),
      shot(
        'Magnitude spectrum',
        axes() + spectrum,
        'The computed DFT places the energy in bins 3 and 12. Only the positive-frequency half is drawn.'
      ),
      shot(
        'Reconstruct after removing the ripple',
        plot(signal, c.muted) +
          plot(
            signal.map((_, i) => 0.85 * Math.sin((2 * Math.PI * 3 * i) / n)),
            c.green
          ),
        'Removing the bin-12 component and its conjugate leaves the slow component. Grey retains the input for comparison.'
      )
    ],
    'Computed 64-sample Fourier example. The result demonstrates an optional frequency filter, not a change performed automatically by dft.'
  )
}

function clusters(a: Algorithm): Visual {
  const start: Point[] = [
      [45, 58],
      [149, 164],
      [264, 162]
    ],
    assign = (centres: Point[]) =>
      points.map(([x, y]) =>
        centres.map(([u, v]) => Math.hypot(x - u, y - v)).reduce((best, d, i, ds) => (d < ds[best] ? i : best), 0)
      ),
    mean = (ids: number[], centres: Point[]) =>
      centres.map((p, k) => {
        const group = points.filter((_, i) => ids[i] === k)
        return group.length
          ? ([
              group.reduce((s, p) => s + p[0], 0) / group.length,
              group.reduce((s, p) => s + p[1], 0) / group.length
            ] as Point)
          : p
      })
  if (a.id === 'knn-classifier') {
    const query: Point = [177, 82],
      distances = points
        .map((p, i) => ({ i, d: Math.hypot(p[0] - query[0], p[1] - query[1]) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 5),
      labels = points.map((_, i) => i % 3),
      votes = [0, 0, 0]
    distances.forEach(({ i }) => votes[labels[i]]++)
    const winner = votes.indexOf(Math.max(...votes))
    return visual(
      shot(
        'Labelled training observations',
        cloud(labels) + dot(...query, 7, c.ink),
        'The white point is an unlabelled query in the same feature space.'
      ),
      [
        shot(
          'Measure distance to the query',
          cloud(labels) +
            distances.map(({ i }) => line([query, points[i]], c.muted, 1)).join('') +
            dot(...query, 7, c.ink),
          'Distance is computed in the chosen feature space. Scaling the features changes the neighbourhood.'
        ),
        shot(
          'Select the five nearest samples',
          cloud(labels) +
            distances.map(({ i }) => dot(...points[i], 8, 'none', colours[labels[i]])).join('') +
            dot(...query, 7, c.ink),
          'Only the five closest samples vote in this K = 5 classification example.'
        ),
        shot(
          'Aggregate the neighbour labels',
          votes
            .map(
              (v, i) =>
                rect(60, 44 + i * 50, v * 34, 22, colours[i]) +
                label(70 + v * 34, 60 + i * 50, `${v} votes`, colours[i])
            )
            .join('') + dot(264, 106, 14, colours[winner]),
          `The query receives the ${['violet', 'mint', 'orange'][winner]} class, with ${votes[winner]} of five votes.`
        )
      ],
      'Distances and votes are computed from the displayed two-dimensional sample set.'
    )
  }
  if (a.id === 'pca') {
    const p: Point[] = points.map(([x, y]) => [x, 160 - (x - 50) * 0.42 + (y - 110) * 0.3]),
      mx = p.reduce((s, p) => s + p[0], 0) / p.length,
      my = p.reduce((s, p) => s + p[1], 0) / p.length,
      xx = p.reduce((s, [x]) => s + (x - mx) ** 2, 0),
      yy = p.reduce((s, [, y]) => s + (y - my) ** 2, 0),
      xy = p.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0),
      theta = 0.5 * Math.atan2(2 * xy, xx - yy),
      u: Point = [Math.cos(theta), Math.sin(theta)],
      projected = p.map(([x, y]) => (x - mx) * u[0] + (y - my) * u[1])
    const cloud = p.map(([x, y]) => dot(x, y, 3, c.purple)).join('')
    return visual(
      shot('Correlated features', cloud, 'The observations vary mainly along a diagonal direction.'),
      [
        shot(
          'Subtract the sample mean',
          cloud + centre([mx, my], c.orange) + path(`M${mx} 22V201M26 ${my}H294`, c.orange, 1, 'none', true),
          'Centring makes the mean the origin for the covariance calculation.'
        ),
        shot(
          'Find the dominant eigenvector',
          cloud +
            arrow(mx - u[0] * 115, my - u[1] * 115, mx + u[0] * 115, my + u[1] * 115) +
            p
              .filter((_, i) => i % 4 === 0)
              .map(([x, y], j) =>
                line(
                  [
                    [x, y],
                    [mx + projected[j * 4] * u[0], my + projected[j * 4] * u[1]]
                  ],
                  c.muted,
                  1
                )
              )
              .join(''),
          'The mint axis is computed from the covariance matrix. Projection removes each point’s perpendicular component.'
        ),
        shot(
          'Keep one principal coordinate',
          path('M24 111H296', c.green) +
            projected.map((v, i) => dot(160 + v, 111 + ((i % 3) - 1) * 6, 3, c.green)).join(''),
          'Two-dimensional observations become one scalar per sample. Variation perpendicular to the chosen axis is discarded.'
        )
      ],
      'Mean, covariance direction and projections are computed from the displayed samples.'
    )
  }
  const first = assign(start),
    updated = mean(first, start)
  let final = updated
  for (let i = 0; i < 12; i++) final = mean(assign(final), final)
  return visual(
    shot(
      'Unlabelled observations',
      cloud(),
      'The data contain three visible groups, but their class labels are unknown.'
    ),
    [
      shot(
        'Initialize three centres',
        cloud() + start.map((p, i) => centre(p, colours[i])).join(''),
        'These deliberately imperfect starting centres make the effect of the updates visible.'
      ),
      shot(
        'Assign points and recompute means',
        cloud(first) +
          start.map((p, i) => arrow(...p, ...updated[i], colours[i])).join('') +
          updated.map((p, i) => centre(p, colours[i])).join(''),
        'Each point takes the colour of its nearest centre. Arrows show the move from the initial centres to their assigned sample means.'
      ),
      shot(
        'Repeat until assignments stabilize',
        cloud(assign(final)) + final.map((p, i) => centre(p, colours[i])).join(''),
        'The displayed result follows twelve assignment/mean updates. Different initial centres can produce a different local solution.'
      )
    ],
    'Nearest-centre assignments and mean updates are computed from the displayed sample coordinates.'
  )
}

function classifier(a: Algorithm): Visual {
  if (a.id === 'random-forests') {
    const tree = (x: number, active: boolean) =>
      path(
        `M${x} 35L${x - 28} 85M${x} 35L${x + 28} 85M${x + 28} 85L${x + 12} 137M${x + 28} 85L${x + 43} 137`,
        c.muted,
        1.5
      ) +
      dot(x, 35, 8, c.purple) +
      dot(x - 28, 85, 7, c.purple) +
      dot(x + 28, 85, 7, active ? c.green : c.purple) +
      dot(x + 12, 137, 7, c.orange) +
      dot(x + 43, 137, 7, active ? c.green : c.purple)
    return visual(
      shot(
        'Several decision trees',
        [58, 151, 244].map((x) => tree(x, false)).join(''),
        'Each tree uses feature tests to route a sample to a prediction.'
      ),
      [
        shot(
          'Evaluate feature tests',
          [58, 151, 244].map((x) => tree(x, false) + label(x, 183, 'x₁, x₂, …', c.orange, 'middle')).join(''),
          'The same query enters every tree; their thresholds and selected features differ.'
        ),
        shot(
          'Follow one path per tree',
          [58, 151, 244].map((x) => tree(x, true) + path(`M${x} 35L${x + 28} 85L${x + 43} 137`, c.green, 3)).join(''),
          'The highlighted path leads to one leaf prediction in each illustrative tree.'
        ),
        shot(
          'Aggregate the predictions',
          rect(52, 66, 174, 28, c.green) +
            rect(52, 120, 87, 28, c.orange) +
            label(238, 86, '2', c.green) +
            label(151, 140, '1', c.orange) +
            label(160, 200, 'majority class: mint', c.green, 'middle'),
          'Two illustrative trees vote mint and one votes orange. Classification aggregates votes; regression aggregates numeric responses.'
        )
      ]
    )
  }
  const p: Point[] = Array.from({ length: 24 }, (_, i) => [55 + (i % 6) * 39, 64 + Math.floor(i / 6) * 31]),
    groups = p.map(([x, y]) => (x + y > 245 ? 1 : 0)),
    cloud = p.map(([x, y], i) => dot(x, y, 4, colours[groups[i]])).join('')
  return visual(
    shot('Labelled feature vectors', cloud, 'A linear decision boundary separates these two illustrative classes.'),
    [
      shot(
        'Compare candidate separators',
        cloud + path('M80 190L217 25M160 190L252 25', c.orange, 1.5, 'none', true),
        'Different separating lines can fit the training labels with different margins.'
      ),
      shot(
        'Fit a wide separating margin',
        cloud + path('M59 186L220 25', c.green, 2) + path('M34 186L195 25M84 186L245 25', c.muted, 1, 'none', true),
        'The dashed lines illustrate the margin on either side of a linear separator.'
      ),
      shot(
        'Classify a new feature vector',
        cloud +
          path('M59 186L220 25', c.green, 2) +
          dot(259, 143, 11, c.green) +
          label(259, 168, 'query', c.green, 'middle'),
        'The side of the boundary determines the predicted class in this linear example. Kernel models can produce nonlinear boundaries.'
      )
    ]
  )
}

function background(a: Algorithm): Visual {
  if (a.id === 'retina')
    return visual(
      shot('Changing visual input', scene(), 'The retinal model has spatial filters and a temporal state.'),
      [
        shot(
          'Adapt local contrast',
          scene(0, c.green) +
            Array.from({ length: 5 }, (_, i) => dot(102, 119, 20 + i * 9, 'none', i % 2 ? c.muted : c.orange)).join(''),
          'Local adaptation changes sensitivity around a neighbourhood.'
        ),
        shot(
          'Compare temporal responses',
          scene(30) + rect(82, 78, 49, 86, 'none', c.orange) + arrow(105, 124, 135, 124),
          'Temporal pathways respond to change as the object moves.'
        ),
        shot(
          'Separate detail and motion pathways',
          path('M25 96L80 40L145 99M183 98L222 43L299 99', c.green) +
            label(85, 127, 'detail / colour', c.green, 'middle') +
            arrow(190, 167, 269, 167, c.orange) +
            label(230, 199, 'transient motion', c.orange, 'middle'),
          'Parvocellular and magnocellular outputs emphasize different properties; this is a pathway schematic, not simulated retinal output.'
        )
      ]
    )
  const bg = path('M20 182L74 113L133 171L190 94L298 181Z', c.muted, 1.5, c.muted + '18') + dot(247, 44, 17, c.orange)
  return visual(shot('Current frame', scene(82), 'The object has moved away from its earlier location.'), [
    shot(
      'Learn recurring observations',
      bg +
        [0, 40, 82]
          .map((offset, i) => rect(82 + offset, 78, 49, 86, 'none', [c.muted, c.purple, c.orange][i]))
          .join(''),
      'Previous object locations show why a temporal model needs multiple observations.'
    ),
    shot(
      'Compare the current observation',
      bg +
        rect(164, 78, 49, 86, c.orange + '30', c.orange) +
        label(160, 214, 'persistent scenery agrees; moving region differs', c.orange, 'middle', 10),
      a.id === 'background-knn'
        ? 'Compare the current sample with its history and count nearby values.'
        : 'Compare the current sample with learned mixture components and their support.'
    ),
    shot(
      'Foreground mask',
      rect(164, 78, 49, 86, c.green) +
        label(160, 214, 'foreground retained, background removed', c.green, 'middle', 10),
      'The moving region is retained in this ideal example. Startup, shadows and camera motion complicate real masks.'
    )
  ])
}

function photography(a: Algorithm): Visual {
  if (['inpainting', 'seamless-cloning'].includes(a.id)) {
    const base = Array.from({ length: 256 }, (_, i) => {
        const x = i % 16,
          y = Math.floor(i / 16),
          v = 50 + x * 7 + y * 3
        return rect(48 + x * 14, 0 + y * 14, 14, 14, `rgb(${v} ${v + 8} ${v + 12})`)
      }).join(''),
      hole = rect(126, 49, 37, 129, c.dark)
    const clone = a.id === 'seamless-cloning'
    return visual(
      shot(
        clone ? 'Source patch on a destination' : 'A masked strip in the image',
        base + (clone ? rect(112, 52, 85, 116, c.purple + 'bb') : hole),
        'The highlighted region is the part to reconstruct.'
      ),
      [
        shot(
          clone ? 'Preserve the destination boundary' : 'Identify known boundary samples',
          base +
            (clone
              ? rect(112, 52, 85, 116, c.purple + 'bb', c.orange)
              : hole + rect(124, 47, 41, 133, 'none', c.orange)),
          a.steps[0]
        ),
        shot(
          clone ? 'Transfer the source gradient field' : 'Advance from known pixels',
          base +
            (clone
              ? rect(112, 52, 85, 116, c.purple + '55') + arrow(125, 145, 180, 70, c.orange)
              : rect(138, 59, 13, 108, c.dark)),
          a.steps[1]
        ),
        shot(
          clone ? 'Blend a reconstructed patch' : 'Fill the missing strip',
          base + (clone ? path('M131 150V79L180 110Z', c.green, 2, c.green + '30') : path('M126 178H163', c.green, 2)),
          clone
            ? 'Boundary values constrain the solve while source gradients shape the interior. This illustrates the blend, not a Poisson solution.'
            : 'The smooth field illustrates continuation into a hole. Texture and larger missing structures are not recovered simply by extending a gradient.'
        )
      ]
    )
  }
  const mini = (x: number, y: number, w: number, brightness = 1) =>
    `<g transform="translate(${x} ${y}) scale(${w / 320})" opacity="${brightness}">${scene()}</g>`
  if (a.id === 'stitching')
    return visual(
      shot(
        'Overlapping views',
        mini(0, 35, 180) + mini(130, 52, 180) + rect(130, 45, 45, 105, 'none', c.orange),
        'Shared content ties neighbouring images into one panorama.'
      ),
      [
        shot(
          'Match the overlap',
          mini(0, 35, 180) + mini(130, 52, 180) + arrow(130, 95, 191, 100) + arrow(100, 112, 160, 116),
          a.steps[0]
        ),
        shot(
          'Warp to a common projection',
          mini(0, 35, 180) + mini(124, 35, 180) + path('M156 49V166', c.orange, 2, 'none', true),
          'Alignment establishes a common geometry. The orange line illustrates a seam through the overlap.'
        ),
        shot(
          'Blend the panorama',
          mini(-2, 18, 320) + label(160, 211, 'shared geometry + exposure + seam blending', c.green, 'middle', 10),
          'A successful stitch requires consistent geometry and exposure. The final scene is an illustrative panorama, not a native stitch of the two drawings.'
        )
      ]
    )
  if (a.id === 'hdr')
    return visual(
      shot(
        'Bracketed exposures',
        mini(0, 0, 160, 0.3) + mini(160, 0, 160, 0.7) + mini(80, 112, 160, 1),
        'Different exposures preserve useful information in different intensity ranges.'
      ),
      [
        shot(
          'Align exposure brackets',
          mini(0, 0, 160, 0.3) + mini(160, 0, 160, 0.7) + rect(93, 110, 110, 79, 'none', c.orange),
          a.steps[0]
        ),
        shot(
          'Select well-exposed evidence',
          scene() + rect(20, 125, 111, 65, 'none', c.purple) + rect(218, 20, 62, 57, 'none', c.orange),
          'Dim and bright regions can draw evidence from different exposures. Clipping cannot be reversed from a single saturated sample.'
        ),
        shot(
          'Map the merged result for display',
          scene(0, c.green) + label(160, 211, 'radiance merge or exposure fusion', c.green, 'middle'),
          'The drawing illustrates combined visibility. Radiance estimation and exposure fusion have different outputs; tone mapping applies to a radiance result.'
        )
      ]
    )
  return visual(
    shot('Fine image level', scene(), 'Large features survive at coarser scales; small details gradually disappear.'),
    [
      shot(
        'Smooth before decimation',
        scene() + rect(68, 64, 82, 113, 'none', c.orange),
        'Low-pass filtering limits aliasing before the sample spacing increases.'
      ),
      shot(
        'Create a half-size level',
        mini(80, 50, 160) + label(160, 196, '½ width × ½ height', c.orange, 'middle'),
        'A half-size image contains one quarter as many samples.'
      ),
      shot(
        'Build a scale pyramid',
        mini(2, 9, 170) +
          mini(190, 89, 90) +
          mini(234, 175, 45) +
          label(101, 161, 'level 0', c.muted, 'middle') +
          label(233, 164, 'level 1', c.muted, 'middle'),
        'Successive levels let an algorithm begin with broad structure and refine detail. A Laplacian pyramid additionally records differences between levels.'
      )
    ]
  )
}

function colour(a: Algorithm): Visual {
  const values = [
      [206, 80, 42],
      [85, 173, 80],
      [55, 94, 189],
      [226, 184, 75],
      [131, 79, 173],
      [90, 164, 176]
    ],
    swatches = (colours: number[][]) =>
      colours
        .map((v, i) => rect(40 + (i % 3) * 81, 31 + Math.floor(i / 3) * 81, 76, 76, `rgb(${v.join(' ')})`))
        .join('')
  const white = a.id === 'white-balance',
    source = white ? values.map(([r, g, b]) => [r, Math.round(g * 0.75), Math.round(b * 0.6)]) : values,
    gray = values.map(([r, g, b]) => Math.round(0.299 * r + 0.587 * g + 0.114 * b))
  return visual(
    shot(
      white ? 'Warm colour cast' : 'Three-channel colour samples',
      swatches(source),
      'Colours depend on both channel order and the range assigned to each channel.'
    ),
    [
      shot(
        'Inspect channel contributions',
        source
          .slice(0, 3)
          .map((rgb, i) =>
            rgb
              .map(
                (v, j) =>
                  rect(37 + j * 86, 32 + i * 58, 25 + v / 5, 32, [c.orange, c.green, c.blue][j]) +
                  label(43 + j * 86, 53 + i * 58, v, c.dark)
              )
              .join('')
          )
          .join(''),
        'Rows show the first three input colours; columns show their red, green and blue values.'
      ),
      shot(
        white ? 'Estimate per-channel gains' : 'Apply a colour transform',
        label(160, 66, white ? 'R × 1.00' : 'Y = 0.299 R', c.orange, 'middle', 17) +
          label(160, 109, white ? 'G × 1.33' : '+ 0.587 G', c.green, 'middle', 17) +
          label(160, 152, white ? 'B × 1.67' : '+ 0.114 B', c.blue, 'middle', 17),
        white
          ? 'These illustrative gains invert the known cast in the synthetic input. A real white-balance method must estimate illumination.'
          : 'This example demonstrates RGB to grayscale. A BGR source needs the matching conversion code.'
      ),
      shot(
        white ? 'Correct the colour cast' : 'One-channel luminance values',
        swatches(white ? values : gray.map((v) => [v, v, v])) +
          (white
            ? ''
            : gray
                .map((v, i) =>
                  label(78 + (i % 3) * 81, 78 + Math.floor(i / 3) * 81, v, v > 140 ? c.dark : c.ink, 'middle', 16)
                )
                .join('')),
        white
          ? 'The chosen gains restore the original swatches. Incorrect illumination assumptions can produce incorrect colour.'
          : 'Weighted luminance converts three values into one. Other colour conversions preserve different properties.'
      )
    ]
  )
}

function quality(): Visual {
  const original = Array.from({ length: 192 }, (_, i) => {
      const x = i % 16,
        y = Math.floor(i / 16)
      return x > 3 && x < 11 && y > 2 && y < 10 ? 205 : 45
    }),
    changed = original.map((v, i) => (i % 16 === 10 && i > 40 && i < 160 ? 90 : v)),
    error = original.map((v, i) => (v - changed[i]) ** 2),
    mse = error.reduce((s, v) => s + v, 0) / error.length,
    psnr = 10 * Math.log10(255 ** 2 / mse)
  const image = (a: number[], heat = false) =>
    a
      .map((v, i) =>
        rect(
          40 + (i % 16) * 15,
          22 + Math.floor(i / 16) * 15,
          15,
          15,
          heat ? (v ? c.orange : c.dark) : `rgb(${v} ${v} ${v})`
        )
      )
      .join('')
  return visual(
    shot('Reference image', image(original), 'Compare aligned images with the same numeric range.'),
    [
      shot('Inspect the reconstruction', image(changed), 'A narrow vertical strip differs from the reference.'),
      shot(
        'Locate squared pixel error',
        image(error, true),
        'Orange pixels contain the error. Most of the image is unchanged; the map reveals where the scalar score came from.'
      ),
      shot(
        'Aggregate the error',
        label(160, 77, `MSE ${mse.toFixed(1)}`, c.orange, 'middle', 24) +
          label(160, 128, `PSNR ${psnr.toFixed(2)} dB`, c.green, 'middle', 24) +
          label(160, 175, '8-bit range: MAX = 255', c.muted, 'middle'),
        'These values are computed from the displayed 16 × 12 arrays. SSIM and other perceptual metrics use different definitions.'
      )
    ],
    'Computed MSE and PSNR example. Scalar error metrics summarize a spatial difference; they do not explain perceptual quality by themselves.'
  )
}

function network(a: Algorithm): Visual {
  const sr = a.id === 'dnn-super-resolution',
    tensor = Array.from({ length: 64 }, (_, i) =>
      tile(79 + (i % 8) * 20, 29 + Math.floor(i / 8) * 20, 20, i % 8 > 2 && i % 8 < 6 && i > 15 ? c.purple : c.grid)
    ).join('')
  const maps = Array.from({ length: 3 }, (_, layer) =>
    Array.from({ length: 36 }, (_, i) =>
      tile(
        28 + layer * 97 + (i % 6) * 14,
        60 + Math.floor(i / 6) * 14,
        14,
        (i + layer * 3) % 7 < 3 ? colours[layer] : c.grid
      )
    ).join('')
  ).join('')
  return visual(
    shot(
      sr ? 'Low-resolution image' : 'Image to classify',
      tensor,
      'The sample drawing makes the data representation visible; it is not an actual model input/output pair.'
    ),
    [
      shot(
        'Prepare a tensor',
        tensor + label(160, 211, sr ? 'channels × height × width' : 'N × C × H × W', c.orange, 'middle'),
        a.steps[1]
      ),
      shot(
        'Transform feature maps',
        maps +
          arrow(112, 174, 143, 174) +
          arrow(209, 174, 240, 174) +
          label(160, 211, 'illustrative learned feature activations', c.muted, 'middle', 10),
        'Successive learned operations transform activations. Actual layers and tensor shapes come from the loaded model.'
      ),
      shot(
        sr ? 'Predict higher-resolution samples' : 'Interpret the output tensor',
        sr
          ? Array.from({ length: 256 }, (_, i) =>
              tile(
                79 + (i % 16) * 10,
                29 + Math.floor(i / 16) * 10,
                10,
                i % 16 > 5 && i % 16 < 12 && i > 63 ? c.green : c.grid
              )
            ).join('') + label(160, 211, 'example scale: 2×', c.green, 'middle')
          : [0.76, 0.18, 0.06]
              .map(
                (v, i) =>
                  rect(54, 43 + i * 48, v * 225, 24, i === 0 ? c.green : c.muted) +
                  label(62 + v * 225, 60 + i * 48, v.toFixed(2), c.ink)
              )
              .join(''),
        sr
          ? 'Twice the width and height gives four times as many samples. Learned detail depends on the model and may not match the original scene.'
          : 'These illustrative class scores show one possible output contract. Detection, segmentation and other networks require different interpretation.'
      )
    ]
  )
}

function codes(a: Algorithm): Visual {
  if (a.id === 'structured-light') {
    const pattern = (phase = 0) =>
      Array.from({ length: 18 }, (_, i) => rect(25 + i * 15, 33, 15, 154, (i + phase) % 4 < 2 ? c.ink : c.dark)).join(
        ''
      )
    return visual(
      shot('Projected stripe sequence', pattern(), 'A calibrated projector illuminates the scene with known patterns.'),
      [
        shot(
          'Capture changing patterns',
          pattern(1) + path('M123 28Q178 108 122 195', c.orange, 3),
          'A surface changes where projected stripes appear in the camera image.'
        ),
        shot(
          'Decode projector correspondence',
          Array.from({ length: 18 }, (_, i) => rect(25 + i * 15, 33, 15, 154, `hsl(${180 + i * 6} 65% 55%)`)).join('') +
            label(160, 211, 'colour encodes projector coordinate', c.green, 'middle', 10),
          a.steps[1]
        ),
        shot(
          'Use calibration to recover shape',
          Array.from({ length: 9 }, (_, i) =>
            path(`M43 ${45 + i * 16}Q157 ${-8 + i * 16} 275 ${45 + i * 16}`, c.green, 1.5)
          ).join(''),
          'The calibrated geometry converts correspondences to surface depth. This curved grid illustrates the reconstruction.'
        )
      ]
    )
  }
  const text = ['ocr', 'text-detection'].includes(a.id),
    glyph = label(160, 123, 'Vision', c.ink, 'middle', 49)
  const pattern = Array.from({ length: 64 }, (_, i) =>
    tile(
      76 + (i % 8) * 21,
      25 + Math.floor(i / 8) * 21,
      21,
      i % 8 === 0 || i % 8 === 7 || i < 8 || i >= 56 || (i * 7) % 11 < 5 ? c.ink : c.dark
    )
  ).join('')
  const input = text ? glyph : `<g transform="translate(25 16) skewX(-13) scale(.9)">${pattern}</g>`
  return visual(
    shot(
      text ? 'Text in an image' : 'A code seen in perspective',
      input,
      text
        ? 'Characters are pixels before a recognizer assigns text to them.'
        : 'The illustrative module grid is a schematic, not a valid encoded marker.'
    ),
    [
      shot(
        text ? 'Find candidate character regions' : 'Find the candidate boundary',
        input +
          (text
            ? Array.from({ length: 6 }, (_, i) => rect(79 + i * 27, 78, 27, 54, 'none', c.orange)).join('')
            : path('M87 36L237 36L204 190L54 190Z', c.orange, 2)),
        a.steps[0]
      ),
      shot(
        text ? 'Group and normalize the region' : 'Rectify and sample the grid',
        text ? glyph + rect(69, 69, 184, 70, 'none', c.green) : pattern + rect(74, 23, 170, 170, 'none', c.green),
        a.steps[1]
      ),
      shot(
        a.id === 'text-detection'
          ? 'Return a text region'
          : text
            ? 'Recognized character sequence'
            : 'Validate and decode',
        a.id === 'text-detection'
          ? glyph + rect(69, 69, 184, 70, 'none', c.green) + label(160, 187, 'region coordinates', c.green, 'middle')
          : text
            ? label(160, 113, '"Vision"', c.green, 'middle', 35) +
              label(160, 164, 'characters, confidence, geometry', c.muted, 'middle', 10)
            : rect(60, 54, 200, 115, c.green + '0e', c.green, 8) +
              label(160, 96, 'dictionary / code checks', c.green, 'middle') +
              label(160, 132, 'payload + corners', c.ink, 'middle', 18),
        a.id === 'text-detection'
          ? 'Detection returns geometry. Recognition is a separate operation.'
          : text
            ? 'Recognition assigns characters to the detected pixels. Language data and layout assumptions influence the result.'
            : 'A candidate must pass the dictionary or code validity checks before it yields a payload. The schematic grid above is not decoded.'
      )
    ]
  )
}

/** Signal, statistical and multi-stage pipeline illustrations, with computed examples identified in their notes. */
export function systemVisual(a: Algorithm): Visual | undefined {
  if (a.diagram === 'kalman') return kalman()
  if (a.diagram === 'polar') return polar(a)
  if (a.diagram === 'frequency') return frequency(a)
  if (a.diagram === 'clusters') return clusters(a)
  if (a.diagram === 'classifier') return classifier(a)
  if (a.diagram === 'background') return background(a)
  if (['pyramid', 'inpaint'].includes(a.diagram)) return photography(a)
  if (a.diagram === 'colour') return colour(a)
  if (a.diagram === 'quality') return quality()
  if (a.diagram === 'network') return network(a)
  if (['text', 'marker'].includes(a.diagram)) return codes(a)
}
