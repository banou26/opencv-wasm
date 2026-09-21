/** Draw the deterministic geometric sample used by the image experiments. */
export const drawSample = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = 448
  canvas.height = 320
  const ctx = canvas.getContext('2d')!
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
