import type { LabImage, NativePixels } from './types'
/** Two synchronized, unresampled canvas views with exact pixel sampling, keyboard navigation and a local magnifier. */
export class PixelViewer {
  private images: (LabImage | undefined)[] = []
  private native?: NativePixels
  private scale = 1
  private pinned = false
  private point = { x: 0, y: 0, source: 0 }
  private abort = new AbortController()
  private observer: ResizeObserver
  private scrollPositions = [
    [0, 0],
    [0, 0]
  ]
  private readonly canvases: HTMLCanvasElement[]
  private readonly panes: HTMLElement[]
  private readonly zoom: HTMLSelectElement
  constructor(private root: HTMLElement) {
    this.canvases = [...root.querySelectorAll<HTMLCanvasElement>('.lab-main-canvas')]
    this.panes = [...root.querySelectorAll<HTMLElement>('.pixel-viewport')]
    this.zoom = root.querySelector<HTMLSelectElement>('[name=zoom]')!
    const options = { signal: this.abort.signal }
    this.zoom.addEventListener('change', () => this.resize(), options)
    root.querySelector('.zoom-in')!.addEventListener('click', () => this.stepZoom(1), options)
    root.querySelector('.zoom-out')!.addEventListener('click', () => this.stepZoom(-1), options)
    root.querySelector('.unpin-pixel')!.addEventListener(
      'click',
      () => {
        this.pinned = false
        this.inspect()
      },
      options
    )
    this.canvases.forEach((canvas, source) => {
      const position = (event: PointerEvent) => {
        const rect = canvas.getBoundingClientRect()
        this.point = {
          x: Math.floor(((event.clientX - rect.left) * canvas.width) / rect.width),
          y: Math.floor(((event.clientY - rect.top) * canvas.height) / rect.height),
          source
        }
        this.inspect()
      }
      canvas.addEventListener(
        'pointermove',
        (event) => {
          if (!this.pinned) position(event)
        },
        options
      )
      canvas.addEventListener(
        'click',
        (event) => {
          this.pinned = true
          position(event)
          this.panes[source].focus({ preventScroll: true })
        },
        options
      )
      this.panes[source].addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Escape') {
            this.pinned = false
            this.inspect()
            return
          }
          const delta: Record<string, [number, number]> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1]
          }
          if (!delta[event.key]) return
          event.preventDefault()
          this.pinned = true
          this.point.source = source
          this.point.x += delta[event.key][0]
          this.point.y += delta[event.key][1]
          this.inspect()
          this.reveal(source)
        },
        options
      )
      this.panes[source].addEventListener(
        'scroll',
        () => {
          const pane = this.panes[source],
            [x, y] = this.scrollPositions[source]
          if (pane.scrollLeft === x && pane.scrollTop === y) return
          this.pan(() => this.syncScroll(source))
        },
        options
      )
      this.panes[source].addEventListener(
        'wheel',
        (event) => {
          if (!event.ctrlKey && !event.metaKey) return
          event.preventDefault()
          const rect = canvas.getBoundingClientRect(),
            x = (event.clientX - rect.left) / this.scale,
            y = (event.clientY - rect.top) / this.scale
          this.stepZoom(event.deltaY < 0 ? 1 : -1)
          const pane = this.panes[source],
            bounds = pane.getBoundingClientRect()
          this.pan(() => {
            pane.scrollLeft = x * this.scale - (event.clientX - bounds.left)
            pane.scrollTop = y * this.scale - (event.clientY - bounds.top)
            this.syncScroll(source)
          })
        },
        { ...options, passive: false }
      )
    })
    this.observer = new ResizeObserver(() => {
      if (this.zoom.value === 'fit') this.resize()
    })
    this.panes.forEach((pane) => this.observer.observe(pane))
    root.querySelector<HTMLSelectElement>('[name=pixel-source]')!.addEventListener(
      'change',
      (event) => {
        this.point.source = Number((event.target as HTMLSelectElement).value)
        this.pinned = true
        this.inspect()
      },
      options
    )
    for (const key of ['x', 'y'])
      root.querySelector<HTMLInputElement>(`[name=pixel-${key}]`)!.addEventListener(
        'change',
        (event) => {
          const value = Number((event.target as HTMLInputElement).value)
          if (Number.isFinite(value)) {
            this.point[key as 'x' | 'y'] = Math.round(value)
            this.point.source = Number(root.querySelector<HTMLSelectElement>('[name=pixel-source]')!.value)
            this.pinned = true
            this.inspect()
            this.reveal(this.point.source)
          }
        },
        options
      )
  }
  /** Replace a view with copied worker pixels; output native values must have the same dimensions. */
  setImage(index: number, image: LabImage, native?: NativePixels) {
    this.images[index] = image
    const canvas = this.canvases[index]
    canvas.width = image.width
    canvas.height = image.height
    const data = new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height)
    canvas.getContext('2d')!.putImageData(data, 0, 0)
    this.root.querySelectorAll('.image-dimensions')[index].textContent = `${image.width} × ${image.height}`
    if (index === 1) this.native = native
    this.resize()
    this.inspect()
  }
  /** Remove obsolete output and inspector values while a changed experiment is pending. */
  clearOutput() {
    this.images[1] = undefined
    this.native = undefined
    const canvas = this.canvases[1]
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    this.root.querySelectorAll('.image-dimensions')[1].textContent = 'Waiting for a result'
    this.inspect()
  }
  private stepZoom(direction: number) {
    const levels = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32]
    const next =
      direction > 0
        ? levels.find((level) => level > this.scale + 0.001)
        : [...levels].reverse().find((level) => level < this.scale - 0.001)
    this.zoom.value = String(next ?? (direction > 0 ? 32 : 0.125))
    this.resize()
  }
  private resize() {
    const old = this.scale
    this.scale =
      this.zoom.value === 'fit'
        ? Math.min(
            ...this.canvases.map((canvas, i) =>
              Math.min(
                1,
                Math.max(1, this.panes[i].clientWidth - 2) / canvas.width,
                Math.max(1, this.panes[i].clientHeight - 2) / canvas.height
              )
            )
          )
        : Number(this.zoom.value)
    this.pan(() => {
      for (let i = 0; i < 2; i++) {
        const pane = this.panes[i],
          x = (pane.scrollLeft + pane.clientWidth / 2) / old,
          y = (pane.scrollTop + pane.clientHeight / 2) / old,
          canvas = this.canvases[i]
        canvas.style.width = `${canvas.width * this.scale}px`
        canvas.style.height = `${canvas.height * this.scale}px`
        pane.scrollLeft = x * this.scale - pane.clientWidth / 2
        pane.scrollTop = y * this.scale - pane.clientHeight / 2
      }
      this.syncScroll(this.point.source)
    })
    this.root.querySelector('.zoom-readout')!.textContent = `${Math.round(this.scale * 100)}% · nearest pixel`
    this.inspect()
  }
  private reveal(source: number) {
    const pane = this.panes[source],
      x = (this.point.x + 0.5) * this.scale,
      y = (this.point.y + 0.5) * this.scale
    this.pan(() => {
      if (x < pane.scrollLeft || x > pane.scrollLeft + pane.clientWidth) pane.scrollLeft = x - pane.clientWidth / 2
      if (y < pane.scrollTop || y > pane.scrollTop + pane.clientHeight) pane.scrollTop = y - pane.clientHeight / 2
      this.syncScroll(source)
    })
  }
  private syncScroll(source: number) {
    const from = this.panes[source],
      to = this.panes[1 - source]
    to.scrollLeft = from.scrollLeft
    to.scrollTop = from.scrollTop
  }
  private pan(update: () => void) {
    update()
    // Remember the positions we set so delayed scroll events cannot echo an obsolete pan.
    // A new user scroll still differs from these positions and is synchronized immediately.
    this.scrollPositions = this.panes.map((pane) => [pane.scrollLeft, pane.scrollTop])
  }

  private inspect() {
    const selected = this.images[this.point.source] ?? this.images[0]
    if (!selected) return
    this.point.x = Math.max(0, Math.min(selected.width - 1, this.point.x))
    this.point.y = Math.max(0, Math.min(selected.height - 1, this.point.y))
    this.root.querySelector<HTMLSelectElement>('[name=pixel-source]')!.value = String(this.point.source)
    this.root.querySelector('.pixel-state')!.textContent = this.pinned
      ? 'Pinned. Arrow keys move one pixel; Escape releases.'
      : 'Hover to inspect. Click to pin a pixel.'
    this.root.querySelector<HTMLButtonElement>('.unpin-pixel')!.disabled = !this.pinned
    for (const key of ['x', 'y']) {
      const field = this.root.querySelector<HTMLInputElement>(`[name=pixel-${key}]`)!
      field.value = String(this.point[key as 'x' | 'y'])
      field.max = String((key === 'x' ? selected.width : selected.height) - 1)
    }
    for (let i = 0; i < 2; i++) {
      const image = this.images[i],
        cross = this.panes[i].querySelector<HTMLElement>('.pixel-crosshair')!,
        card = this.root.querySelectorAll<HTMLElement>('.pixel-card')[i]
      if (!image) {
        cross.hidden = true
        card.querySelector('.pixel-values')!.textContent = 'Run an experiment to inspect its output.'
        card.querySelector('.native-values')!.textContent = ''
        card.querySelector('canvas')!.getContext('2d')!.clearRect(0, 0, 99, 99)
        continue
      }
      // Equal coordinates are intentional. A resize/warp does not preserve scene correspondence.
      const x = this.point.x,
        y = this.point.y
      if (x >= image.width || y >= image.height) {
        cross.hidden = true
        card.querySelector('.pixel-values')!.textContent = `(${x}, ${y}) is outside this image.`
        card.querySelector('.native-values')!.textContent = ''
        card.querySelector('canvas')!.getContext('2d')!.clearRect(0, 0, 99, 99)
        continue
      }
      cross.hidden = false
      cross.style.left = `${x * this.scale}px`
      cross.style.top = `${y * this.scale}px`
      cross.style.width = `${this.scale}px`
      cross.style.height = `${this.scale}px`
      const offset = (y * image.width + x) * 4,
        rgba = Array.from(image.pixels.slice(offset, offset + 4)),
        hex =
          '#' +
          rgba
            .slice(0, 3)
            .map((c) => c.toString(16).padStart(2, '0'))
            .join('')
      card.querySelector('.pixel-values')!.textContent = `(${x}, ${y})\nRGBA ${rgba.join(', ')}\n${hex}`
      card.querySelector<HTMLElement>('.pixel-swatch')!.style.background =
        `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3] / 255})`
      const native = card.querySelector('.native-values')!
      if (i === 1 && this.native) {
        const raw = this.native,
          index = (y * image.width + x) * raw.channels
        native.textContent = Array.from(
          { length: raw.channels },
          (_, c) => `${raw.labels[c] ?? `channel ${c}`}: ${Number(raw.values[index + c].toPrecision(7))}`
        ).join(' · ')
      } else
        native.textContent =
          i === 1 ? 'Display values are 8-bit RGBA.' : 'Values refer to the processed input, after any size limit.'
      const canvas = card.querySelector('canvas')!,
        ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, 99, 99)
      ctx.imageSmoothingEnabled = false
      const left = Math.max(0, x - 4),
        top = Math.max(0, y - 4),
        right = Math.min(image.width, x + 5),
        bottom = Math.min(image.height, y + 5)
      ctx.drawImage(
        this.canvases[i],
        left,
        top,
        right - left,
        bottom - top,
        (left - x + 4) * 11,
        (top - y + 4) * 11,
        (right - left) * 11,
        (bottom - top) * 11
      )
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 3
      ctx.strokeRect(44.5, 44.5, 10, 10)
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1
      ctx.strokeRect(44.5, 44.5, 10, 10)
    }
  }
  /** Remove resize observers and event listeners when navigating away from a lab. */
  dispose() {
    this.observer.disconnect()
    this.abort.abort()
  }
}
