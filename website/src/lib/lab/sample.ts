/** Draw the deterministic geometric sample used by the image experiments. */
export const drawSample = (kind?: 'objects' | 'document'): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = 448
  canvas.height = 320
  const ctx = canvas.getContext('2d')!
  if (kind === 'objects') {
    ctx.fillStyle = '#202632'
    ctx.fillRect(0, 0, 448, 320)
    ctx.fillStyle = '#ece9de'
    for (const [x, y, r] of [
      [80, 80, 32],
      [175, 70, 24],
      [300, 80, 37],
      [72, 219, 36],
      [213, 207, 40],
      [266, 207, 40],
      [369, 243, 25]
    ]) {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    for (let i = 0; i < 60; i++) ctx.fillRect((i * 83) % 448, (i * 71) % 320, 1, 1)
    return canvas
  }
  if (kind === 'document') {
    ctx.fillStyle = '#354154'
    ctx.fillRect(0, 0, 448, 320)
    ctx.save()
    ctx.translate(224, 160)
    ctx.rotate(-0.12)
    const light = ctx.createLinearGradient(-160, 0, 160, 0)
    light.addColorStop(0, '#a3a7aa')
    light.addColorStop(1, '#ffffff')
    ctx.fillStyle = light
    ctx.fillRect(-160, -126, 320, 252)
    ctx.fillStyle = '#1c2631'
    ctx.font = 'bold 20px sans-serif'
    ctx.fillText('OPENCV FIELD NOTES', -137, -87)
    ctx.font = '12px sans-serif'
    const lines = [
      'Make the image useful.',
      'Start with the original pixels.',
      'Reduce noise before finding edges.',
      'Measure which structures survive.',
      'Keep intermediate results visible.',
      'Check the result on your own image.'
    ]
    lines.forEach((text, i) => ctx.fillText(text, -137, -47 + i * 24))
    ctx.restore()
    return canvas
  }
  const g = ctx.createLinearGradient(0, 0, 448, 320)
  g.addColorStop(0, '#222637')
  g.addColorStop(1, '#afb7cc')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 448, 320)
  ctx.fillStyle = '#d9d3f2'
  ctx.fillRect(47, 77, 139, 178)
  ctx.fillStyle = '#525969'
  ctx.fillRect(62, 95, 25, 28)
  ctx.fillRect(107, 95, 25, 28)
  ctx.fillRect(151, 95, 21, 28)
  ctx.fillRect(62, 148, 25, 27)
  ctx.fillRect(107, 148, 25, 27)
  ctx.fillRect(151, 148, 21, 27)
  ctx.fillRect(100, 206, 35, 49)
  ctx.beginPath()
  ctx.moveTo(31, 77)
  ctx.lineTo(116, 23)
  ctx.lineTo(200, 77)
  ctx.closePath()
  ctx.fillStyle = '#9480d4'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(320, 108, 56, 0, Math.PI * 2)
  ctx.fillStyle = '#8eab91'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(337, 95, 25, 0, Math.PI * 2)
  ctx.fillStyle = '#b3cead'
  ctx.fill()
  ctx.fillStyle = '#534c51'
  ctx.fillRect(312, 153, 15, 97)
  ctx.fillStyle = '#dfc28e'
  ctx.beginPath()
  ctx.moveTo(96, 320)
  ctx.lineTo(175, 258)
  ctx.lineTo(221, 258)
  ctx.lineTo(320, 320)
  ctx.fill()
  ctx.font = 'bold 18px system-ui'
  ctx.fillStyle = '#f0ece6'
  ctx.fillText('OpenCV 5', 250, 284)
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = i % 2 ? '#ffffff70' : '#00000060'
    ctx.fillRect((i * 191) % 448, (i * 73) % 320, 1, 1)
  }
  return canvas
}
