/** Three textured, front-facing planes with known horizontal stereo disparities.
 * The rightmost plane is nearest and can occlude its neighbour in the second view.
 * This supplies a useful depth example rather than implying a uniform image shift has varying depth.
 */
export const drawStereoTeachingPair = (): [HTMLCanvasElement, HTMLCanvasElement] => {
  const first = document.createElement('canvas'),
    second = document.createElement('canvas')
  first.width = second.width = 448
  first.height = second.height = 320
  const ctx = first.getContext('2d')!
  const colours = [
    [115, 137, 193],
    [83, 159, 139],
    [190, 131, 91]
  ]
  let seed = 123456
  for (let y = 0; y < first.height; y += 4)
    for (let x = 0; x < first.width; x += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const shade = 0.4 + ((seed >>> 24) / 255) * 0.6
      const colour = colours[Math.min(2, Math.floor(x / 150))]
      ctx.fillStyle = `rgb(${colour.map((v) => Math.round(v * shade)).join(',')})`
      ctx.fillRect(x, y, 4, 4)
    }
  ctx.font = 'bold 15px sans-serif'
  for (const [i, title] of ['FAR: 8 px', 'MID: 16 px', 'NEAR: 24 px'].entries()) {
    ctx.fillStyle = '#101722'
    ctx.fillRect(i * 150 + 12, 133, 120, 40)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(title, i * 150 + 20, 159)
  }
  const after = second.getContext('2d')!
  after.fillStyle = '#101722'
  after.fillRect(0, 0, 448, 320)
  for (let i = 0; i < 3; i++) {
    const x = i * 150,
      width = Math.min(150, 448 - x),
      disparity = (i + 1) * 8
    after.drawImage(first, x, 0, width, 320, x - disparity, 0, width, 320)
  }
  return [first, second]
}
