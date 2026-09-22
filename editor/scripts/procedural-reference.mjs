/** Independent periodic-field reference, including OpenCV's 1/32-pixel linear sampling. */
export const proceduralReference = (width, height, time) => {
  const base = new Float64Array(width * height * 3)
  let seed = 412947
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const noise = (seed >>> 26) / 185
    for (const [c, cx, cy, bias] of [[0, 3, 3, 35], [1, 5, 1, 25], [2, 2, 5, 45]]) base[(y * width + x) * 3 + c] = bias + 185 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (x / width * cx + y / height * cy + noise)))
  }
  const wrap = (v, size) => ((v % size) + size) % size
  const sample = (x, y, c) => base[(wrap(y, height) * width + wrap(x, width)) * 3 + c]
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.round((x - time * width / 240) * 32) / 32, sy = Math.round((y - time * height / 240) * 32) / 32
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0
    for (let c = 0; c < 3; c++) pixels[(y * width + x) * 3 + c] = Math.round((sample(x0, y0, c) * (1 - fx) + sample(x0 + 1, y0, c) * fx) * (1 - fy) + (sample(x0, y0 + 1, c) * (1 - fx) + sample(x0 + 1, y0 + 1, c) * fx) * fy)
  }
  return pixels
}
