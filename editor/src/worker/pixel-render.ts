import { ARRIVE, LEAVE, drawingInk, frameOffset, matteLayer, renderPlate, unpackMask, type PixelFrame } from 'cadence/regional'
import type { RegionalData } from './regional-data'

type Panels = { source: Uint8Array; changes: Uint8Array; ink: Uint8Array; layer: Uint8Array; plate: Uint8Array; drawings: Uint8Array }

/** Display pixels average their source block; flags use the block's strongest entry so thin lines survive. */
const downsample = (width: number, height: number, displayWidth: number, displayHeight: number, paint: (p: number) => [number, number, number], priority: (p: number) => number) => {
  const out = new Uint8Array(displayWidth * displayHeight * 4)
  for (let y = 0; y < displayHeight; y++) {
    const y0 = Math.floor(y * height / displayHeight), y1 = Math.max(y0 + 1, Math.floor((y + 1) * height / displayHeight))
    for (let x = 0; x < displayWidth; x++) {
      const x0 = Math.floor(x * width / displayWidth), x1 = Math.max(x0 + 1, Math.floor((x + 1) * width / displayWidth))
      let best = -1, r = 0, g = 0, b = 0, n = 0, pr = 0, pg = 0, pb = 0
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const p = sy * width + sx, level = priority(p), [cr, cg, cb] = paint(p)
        if (level > 0 && level > best) { best = level; pr = cr; pg = cg; pb = cb }
        r += cr; g += cg; b += cb; n++
      }
      const o = (y * displayWidth + x) * 4
      if (best > 0) { out[o] = pr; out[o + 1] = pg; out[o + 2] = pb } else { out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n }
      out[o + 3] = 255
    }
  }
  return out
}

/** Read-only panels for one source frame; every overlay is computed at full resolution first. */
export const renderPixelPanels = (data: RegionalData, sourceFrame: number, pixels: PixelFrame, displayMaxSide: number) => {
  const camera = data.pixelCamera
  if (!camera) throw new Error('Pixel inspection requires Pixel Camera Path')
  const index = sourceFrame - data.scene.first, { width, height } = pixels, size = width * height
  if (!Number.isSafeInteger(index) || index < 0 || index >= camera.positions.length) throw new RangeError(`Source frame must be in the analyzed range ${data.scene.first} to ${data.scene.last}`)
  if (!Number.isSafeInteger(displayMaxSide) || displayMaxSide < 0 || displayMaxSide > 3840) throw new RangeError('Display max side must be between 0 and 3840')
  const scale = displayMaxSide ? Math.min(1, displayMaxSide / Math.max(width, height)) : 1
  const displayWidth = Math.max(1, Math.round(width * scale)), displayHeight = Math.max(1, Math.round(height * scale))
  const v = pixels.data, rgb = (p: number, k = 1): [number, number, number] => [v[p * 3 + 2]! * k, v[p * 3 + 1]! * k, v[p * 3]! * k]
  const checker = (p: number) => { const x = p % width, y = (p - x) / width; return ((x >> 4) + (y >> 4)) % 2 ? 92 : 62 }
  const evidence = data.pixelEvidence, pairs = evidence?.pairs.length ?? 0
  const changes = new Uint8Array(size)
  if (evidence && index < pairs) {
    const offset = frameOffset(evidence.camera, evidence.atlas, index), pair = evidence.pairs[index]!
    for (let i = 0; i < pair.indices.length; i++) {
      const a = pair.indices[i]!, ay = Math.floor(a / evidence.atlas.width), x = a - ay * evidence.atlas.width - offset.x, y = ay - offset.y
      if (x >= 0 && y >= 0 && x < width && y < height) changes[y * width + x] = pair.flags[i]!
    }
  }
  const ink = evidence ? drawingInk(evidence, index, 'either', Number(data.pixelSilhouettes?.options.recurrence ?? 10)) : new Uint8Array(size)
  const mask = data.pixelSilhouettes ? unpackMask(data.pixelSilhouettes.frames[index]!.packed, size) : new Uint8Array(size)
  const edge = new Uint8Array(size)
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const p = y * width + x
    edge[p] = Number(mask[p] === 1 && (!mask[p - 1] || !mask[p + 1] || !mask[p - width] || !mask[p + width]))
  }
  const plate = data.pixelPlate ? renderPlate(data.pixelPlate, camera, index) : undefined
  let unknown = 0, over12 = 0, over20 = 0, outside = 0
  const residual = new Float32Array(size)
  if (plate) for (let p = 0; p < size; p++) {
    const q = p * 3
    residual[p] = plate.known[p] ? Math.max(Math.abs(v[q]! - plate.data[q]!), Math.abs(v[q + 1]! - plate.data[q + 1]!), Math.abs(v[q + 2]! - plate.data[q + 2]!)) : NaN
    if (mask[p]) continue
    outside++
    if (!plate.known[p]) unknown++
    else { over12 += Number(residual[p]! > 12); over20 += Number(residual[p]! > 20) }
  }
  const matte = plate && data.pixelSilhouettes ? matteLayer(pixels, mask, plate) : undefined
  const layerColor = (p: number): [number, number, number] => {
    const c = checker(p)
    if (!matte) return mask[p] ? rgb(p) : [c, c, c]
    const a = matte.alpha[p]!, q = p * 3
    return [matte.color[q + 2]! * a + c * (1 - a), matte.color[q + 1]! * a + c * (1 - a), matte.color[q]! * a + c * (1 - a)]
  }
  const none = () => 0
  const panels: Omit<Panels, 'drawings'> & { drawings?: Uint8Array } = {
    source: downsample(width, height, displayWidth, displayHeight, p => rgb(p), none),
    changes: downsample(width, height, displayWidth, displayHeight, p => {
      const f = changes[p]!
      return f & ARRIVE && f & LEAVE ? [255, 255, 255] : f & ARRIVE ? [70, 245, 90] : f & LEAVE ? [245, 80, 235] : f ? [240, 210, 60] : rgb(p, .38)
    }, p => changes[p]! ? 1 + Number((changes[p]! & 3) !== 0) : 0),
    ink: downsample(width, height, displayWidth, displayHeight, p => edge[p] ? [40, 225, 255] : ink[p]! & ARRIVE && ink[p]! & LEAVE ? [255, 255, 255] : ink[p]! & ARRIVE ? [70, 245, 90] : ink[p]! & LEAVE ? [245, 80, 235] : rgb(p, mask[p] ? .7 : .3),
      p => edge[p] ? 3 : ink[p] ? 2 : 0),
    layer: downsample(width, height, displayWidth, displayHeight, layerColor, none),
    plate: downsample(width, height, displayWidth, displayHeight, p => {
      if (!plate) return [checker(p), checker(p), checker(p)]
      if (!plate.known[p]) return [checker(p) + 50, 40, checker(p) + 70]
      const q = p * 3, color: [number, number, number] = [plate.data[q + 2]!, plate.data[q + 1]!, plate.data[q]!]
      if (mask[p]) return [color[0] * .55, color[1] * .55, color[2] * .55]
      return residual[p]! > 20 ? [255, 45, 45] : residual[p]! > 12 ? [255, 160, 40] : color
    }, p => plate && plate.known[p] && !mask[p] && residual[p]! > 12 ? 1 + Number(residual[p]! > 20) : 0),
  }
  const sheet = drawingSheet(data, index, Math.max(320, displayWidth * 2))
  panels.drawings = sheet.pixels
  const position = camera.positions[index]!, fit = camera.fits[index]
  const components = data.pixelSilhouettes?.frames[index]!.components ?? []
  const summary = [
    `Source ${sourceFrame}${index < camera.fits.length ? ` -> ${sourceFrame + 1}` : ': final frame, no outgoing pair'}; ${width} x ${height} analysis, ${displayWidth} x ${displayHeight} display`,
    `Camera position ${position.dx.toFixed(3)}, ${position.dy.toFixed(3)} px${fit ? `; next step ${fit.dx.toFixed(3)}, ${fit.dy.toFixed(3)} (residual ${fit.residual.toFixed(3)}, ${fit.samples} samples)` : ''}`,
    evidence && index < pairs ? `Pair change: forward ${evidence.summaries[index]!.forward}, backward ${evidence.summaries[index]!.backward} pixels; noise ${evidence.summaries[index]!.noise.toFixed(3)} codes` : evidence ? 'Final frame: no outgoing pair' : 'Connect Redraw Ink Evidence for change and ink panels',
    data.pixelSilhouettes ? `Silhouettes: ${components.length} components, ${components.reduce((s, c) => s + c.area, 0)} px${components.length ? `; ${components.map(c => `${c.area} px at ${c.box.join(',')}`).join('; ')}` : ''}` : 'Connect Drawing Silhouettes for layer panels',
    plate ? `Plate outside silhouettes: ${outside} px; unknown ${unknown}; over 12 codes ${over12}; over 20 codes ${over20}` : 'Connect Background Plate for the plate panel',
    matte ? `Edge matte: ${matte.unmixed} pixels unmixed against the plate; layer panel shows straight alpha over a checkerboard` : 'Layer panel: binary silhouette (no plate for an edge matte)',
    ...(data.pixelFrames ? data.pixelFrames.frames[index]!.map(([layer, drawing]) => { const d = data.pixelFrames!.layers[layer]!.drawings[drawing]!; return `Layer ${layer}: drawing ${drawing} of ${data.pixelFrames!.layers[layer]!.drawings.length}, frames ${d.first + data.scene.first} to ${d.last + data.scene.first}` }) : ['Connect Layer Frames for the drawing sheet']),
    'Ink colors: green arrived at the last change, magenta leaves at the next, white both. Cyan: silhouette outline.',
  ].join('\n')
  return { width: displayWidth, height: displayHeight, panels: panels as Panels, sheet, summary }
}

/** Every drawing of the layers on screen, in order; the drawing shown at this frame is outlined. */
const drawingSheet = (data: RegionalData, index: number, width: number) => {
  const cell = { width: 160, height: 232 }, columns = Math.max(1, Math.floor(width / cell.width)), labels: { text: string; x: number; y: number; current: boolean }[] = []
  const shown = data.pixelFrames?.frames[index] ?? [], thumbnails = data.pixelDrawings ?? []
  const items = shown.flatMap(([layer, current]) => thumbnails.filter(t => t.layer === layer).map(t => ({ ...t, current: t.drawing === current })))
  const rows = Math.max(1, Math.ceil(items.length / columns)), height = rows * cell.height, pixels = new Uint8Array(width * height * 4)
  for (let p = 0; p < width * height; p++) { pixels[p * 4] = 22; pixels[p * 4 + 1] = 26; pixels[p * 4 + 2] = 30; pixels[p * 4 + 3] = 255 }
  const frames = data.pixelFrames
  for (const [i, item] of items.entries()) {
    const cx = (i % columns) * cell.width + 5, cy = Math.floor(i / columns) * cell.height + 26
    for (let y = 0; y < item.height; y++) for (let x = 0; x < item.width; x++) {
      const o = ((cy + y) * width + cx + x) * 4, t = (y * item.width + x) * 4, c = ((x >> 3) + (y >> 3)) % 2 ? 92 : 62
      if (item.rgba[t + 3]) { pixels[o] = item.rgba[t]!; pixels[o + 1] = item.rgba[t + 1]!; pixels[o + 2] = item.rgba[t + 2]! } else { pixels[o] = c; pixels[o + 1] = c; pixels[o + 2] = c }
    }
    if (item.current) for (let y = cy - 24; y < cy + 202; y++) for (let x = cx - 4; x < cx + 154; x++) {
      if (y < 0 || x < 0 || y >= height || x >= width || (y > cy - 22 && y < cy + 200 && x > cx - 2 && x < cx + 152)) continue
      const o = (y * width + x) * 4; pixels[o] = 40; pixels[o + 1] = 225; pixels[o + 2] = 255
    }
    const d = frames!.layers[item.layer]!.drawings[item.drawing]!
    labels.push({ text: `L${item.layer} D${item.drawing}  ${d.first + data.scene.first}-${d.last + data.scene.first}`, x: cx, y: cy - 8, current: item.current })
  }
  return { width, height, pixels, labels }
}
