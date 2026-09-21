import type { LabImage, NativePixels } from './types'
/** Canvas views linked by relative image position, with native pixel sampling and resolution-aware magnification. */
export class PixelViewer {
  private images: (LabImage | undefined)[] = []
  private native?: NativePixels
  private scale = 1
  private scales = [1, 1]
  private center = { x: 0.5, y: 0.5 }
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
          if (!this.pinned && !(source === 0 && this.root.dataset.selecting === 'true')) position(event)
        },
        options
      )
      canvas.addEventListener(
        'click',
        (event) => {
          if (source === 0 && this.root.dataset.selecting === 'true') return
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
          this.selectSource(source)
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
          if (event.deltaY === 0) return
          event.preventDefault()
          const rect = canvas.getBoundingClientRect(),
            x = (event.clientX - rect.left) / rect.width,
            y = (event.clientY - rect.top) / rect.height
          this.stepZoom(event.deltaY < 0 ? 1 : -1)
          const pane = this.panes[source],
            bounds = pane.getBoundingClientRect()
          this.pan(() => {
            pane.scrollLeft = x * canvas.clientWidth - (event.clientX - bounds.left - pane.clientLeft)
            pane.scrollTop = y * canvas.clientHeight - (event.clientY - bounds.top - pane.clientTop)
            this.syncScroll(source)
          })
        },
        { ...options, passive: false }
      )
    })
    this.observer = new ResizeObserver(() => {
      this.resize()
    })
    this.panes.forEach((pane) => this.observer.observe(pane))
    root.querySelector<HTMLSelectElement>('[name=pixel-source]')!.addEventListener(
      'change',
      (event) => {
        this.selectSource(Number((event.target as HTMLSelectElement).value))
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
    const previous = this.images[index]
    if (previous && this.point.source === index) {
      this.point.x = Math.floor(((this.point.x + 0.5) / previous.width) * image.width)
      this.point.y = Math.floor(((this.point.y + 0.5) / previous.height) * image.height)
    }
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
    const reference = this.images[0] ?? this.canvases[0]
    this.scale =
      this.zoom.value === 'fit'
        ? Math.min(
            ...this.panes.map((pane) =>
              Math.min(
                Math.max(1, pane.clientWidth - 2) / reference.width,
                Math.max(1, pane.clientHeight - 2) / reference.height
              )
            )
          )
        : Number(this.zoom.value)
    this.pan(() => {
      for (let i = 0; i < 2; i++) {
        const canvas = this.canvases[i]
        // Equal-resolution fractions occupy the same display area. Contain differing
        // aspect ratios inside the input frame rather than stretching their pixels.
        this.scales[i] = this.scale * Math.min(reference.width / canvas.width, reference.height / canvas.height)
        canvas.style.width = `${canvas.width * this.scales[i]}px`
        canvas.style.height = `${canvas.height * this.scales[i]}px`
      }
      this.placeCenter(0)
      this.placeCenter(1)
    })
    this.root.querySelector('.zoom-readout')!.textContent =
      `Input ${Math.round(this.scales[0] * 100)}% · output ${Math.round(this.scales[1] * 100)}%`
    this.inspect()
  }
  private reveal(source: number) {
    const pane = this.panes[source],
      x = (this.point.x + 0.5) * this.scales[source],
      y = (this.point.y + 0.5) * this.scales[source]
    this.pan(() => {
      if (x < pane.scrollLeft || x > pane.scrollLeft + pane.clientWidth) pane.scrollLeft = x - pane.clientWidth / 2
      if (y < pane.scrollTop || y > pane.scrollTop + pane.clientHeight) pane.scrollTop = y - pane.clientHeight / 2
      this.syncScroll(source)
    })
  }
  private syncScroll(source: number) {
    const from = this.panes[source],
      canvas = this.canvases[source]
    this.center = {
      x: canvas.clientWidth > from.clientWidth ? (from.scrollLeft + from.clientWidth / 2) / canvas.clientWidth : 0.5,
      y: canvas.clientHeight > from.clientHeight ? (from.scrollTop + from.clientHeight / 2) / canvas.clientHeight : 0.5
    }
    this.placeCenter(1 - source)
  }
  private placeCenter(index: number) {
    const pane = this.panes[index],
      canvas = this.canvases[index]
    pane.scrollLeft = this.center.x * canvas.clientWidth - pane.clientWidth / 2
    pane.scrollTop = this.center.y * canvas.clientHeight - pane.clientHeight / 2
  }
  private pixelIn(index: number) {
    const selected = this.images[this.point.source] ?? this.images[0],
      target = this.images[index]
    if (!selected || !target || index === this.point.source) return { x: this.point.x, y: this.point.y }
    return {
      x: Math.min(target.width - 1, Math.floor(((this.point.x + 0.5) / selected.width) * target.width)),
      y: Math.min(target.height - 1, Math.floor(((this.point.y + 0.5) / selected.height) * target.height))
    }
  }
  private selectSource(source: number) {
    this.point = { ...this.pixelIn(source), source }
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
    // Anchor both neighbourhoods to the output pixel grid, then preserve the same
    // image scale as the linked viewers. Native pixels can occupy different sizes.
    const referenceIndex = this.images[1] ? 1 : 0,
      reference = this.images[referenceIndex]!,
      referencePoint = this.pixelIn(referenceIndex),
      centerX = (referencePoint.x + 0.5) / reference.width,
      centerY = (referencePoint.y + 0.5) / reference.height
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
      const { x, y } = this.pixelIn(i)
      if (x >= image.width || y >= image.height) {
        cross.hidden = true
        card.querySelector('.pixel-values')!.textContent = `(${x}, ${y}) is outside this image.`
        card.querySelector('.native-values')!.textContent = ''
        card.querySelector('canvas')!.getContext('2d')!.clearRect(0, 0, 99, 99)
        continue
      }
      cross.hidden = false
      cross.style.left = `${x * this.scales[i]}px`
      cross.style.top = `${y * this.scales[i]}px`
      cross.style.width = `${this.scales[i]}px`
      cross.style.height = `${this.scales[i]}px`
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
          (_, c) =>
            `${raw.labels[c] ?? `channel ${c}`}: ${Number.isFinite(raw.values[index + c]) ? Number(raw.values[index + c].toPrecision(7)) : 'unavailable'}`
        ).join(' · ')
      } else
        native.textContent =
          i === 1 ? 'Display values are 8-bit RGBA.' : 'Values refer to the processed input, after any size limit.'
      const canvas = card.querySelector('canvas')!,
        ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, 99, 99)
      ctx.imageSmoothingEnabled = false
      const magnification = (11 * this.scales[i]) / this.scales[referenceIndex],
        cx = centerX * image.width,
        cy = centerY * image.height,
        radius = 49.5 / magnification,
        left = Math.max(0, Math.floor(cx - radius)),
        top = Math.max(0, Math.floor(cy - radius)),
        right = Math.min(image.width, Math.ceil(cx + radius)),
        bottom = Math.min(image.height, Math.ceil(cy + radius))
      ctx.drawImage(
        this.canvases[i],
        left,
        top,
        right - left,
        bottom - top,
        49.5 + (left - cx) * magnification,
        49.5 + (top - cy) * magnification,
        (right - left) * magnification,
        (bottom - top) * magnification
      )
      const inset = Math.min(0.5, magnification / 4),
        pixelLeft = 49.5 + (x - cx) * magnification + inset,
        pixelTop = 49.5 + (y - cy) * magnification + inset,
        pixelSize = magnification - inset * 2
      ctx.strokeStyle = '#000'
      ctx.lineWidth = Math.min(3, magnification / 3)
      ctx.strokeRect(pixelLeft, pixelTop, pixelSize, pixelSize)
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = Math.min(1, magnification / 6)
      ctx.strokeRect(pixelLeft, pixelTop, pixelSize, pixelSize)
    }
  }
  /** Remove resize observers and event listeners when navigating away from a lab. */
  dispose() {
    this.observer.disconnect()
    this.abort.abort()
  }
}
