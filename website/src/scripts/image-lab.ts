import LabWorker from './lab.worker.ts?worker'
import { PixelViewer } from '../lib/lab/viewer'
import { drawSample } from '../lib/lab/sample'
import type { LabImage, LabRecipe, LabRequest, LabResponse, Parameters } from '../lib/lab/types'
type Entry = LabRecipe & { id: string; title: string }
class ImageLab extends HTMLElement {
  private worker?: Worker
  private viewer?: PixelViewer
  private abort?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  connectedCallback() {
    if (this.viewer) return
    this.abort = new AbortController()
    const events = { signal: this.abort.signal },
      q = <T extends Element = HTMLElement>(selector: string) => this.querySelector<T>(selector)!
    const catalog = JSON.parse(q('.lab-catalog').textContent!) as Entry[],
      select = q<HTMLSelectElement>('[name=algorithm]')
    const initial = new URL(location.href).searchParams.get('algorithm')
    let entry = catalog.find((a) => a.id === (select && initial ? initial : this.dataset.algorithm)) ?? catalog[0]
    if (select) select.value = entry.id
    this.dataset.algorithm = entry.id
    const status = q('.lab-status'),
      run = q<HTMLButtonElement>('.load-runtime'),
      stop = q<HTMLButtonElement>('.cancel-run'),
      save = q<HTMLButtonElement>('.download'),
      auto = q<HTMLInputElement>('[name=auto]'),
      resolution = q<HTMLSelectElement>('[name=resolution]')
    let original: HTMLCanvasElement | ImageBitmap = drawSample(),
      secondOriginal: ImageBitmap | undefined,
      primary: LabImage,
      secondary: LabImage | undefined,
      params: Parameters = {},
      assets: Record<string, Uint8Array> = {},
      sequence = 0,
      revision = 0,
      inFlightRevision = -1,
      busy = false,
      pending = false,
      loaded = false,
      uploadEpoch = 0,
      secondEpoch = 0,
      filename = 'Built-in sample',
      secondFilename = '',
      drag: { id: number; x: number; y: number } | undefined
    const loadingInputs = new Set<HTMLInputElement>()
    this.viewer = new PixelViewer(this)
    const message = (text: string, state = 'idle') => {
      status.textContent = text
      this.dataset.state = state
    }
    const missing = () => entry.assets?.filter((asset) => asset.required && !assets[asset.key]) ?? []
    const readiness = () => {
      const required = missing()
      run.disabled = required.length > 0 || loadingInputs.size > 0
      run.title = required.length ? `Choose ${required.map((asset) => asset.label).join(', ')} first` : ''
      if (required.length)
        message(`Choose ${required.map((asset) => asset.label).join(', ')} to run this experiment.`, 'needs-input')
    }
    const inspectInput = () =>
      this.viewer!.setImage(
        0,
        q<HTMLSelectElement>('[name=inspect-input]').value === 'second' && secondary ? secondary : primary
      )
    const pixels = (source: HTMLCanvasElement | ImageBitmap, maxSide: number): LabImage => {
      const scale = Math.min(1, maxSide / Math.max(source.width, source.height)),
        canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(source.width * scale))
      canvas.height = Math.max(1, Math.round(source.height * scale))
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
      return { pixels: image.data, width: image.width, height: image.height }
    }
    const prepare = () => {
      const cap = Math.min(Number(resolution.value), entry.maxSide ?? Infinity)
      primary = pixels(original, cap)
      if (entry.second) {
        if (secondOriginal) secondary = pixels(secondOriginal, cap)
        else {
          const data = new Uint8ClampedArray(primary.pixels.length),
            w = primary.width,
            h = primary.height
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              let sx = entry.id === 'hdr' || entry.id === 'template-matching' ? x : x + 12
              if (w === 1) sx = 0
              else while (sx >= w || sx < 0) sx = sx >= w ? 2 * w - sx - 2 : -sx
              for (let c = 0; c < 4; c++)
                data[(y * w + x) * 4 + c] =
                  primary.pixels[(y * w + sx) * 4 + c] * (entry.id === 'hdr' && c < 3 ? 0.45 : 1)
            }
          secondary = { pixels: data, width: w, height: h }
        }
        q('.second-note').textContent = secondOriginal
          ? `${secondFilename} · ${secondOriginal.width} × ${secondOriginal.height}. Resized to the first image’s dimensions for processing.`
          : entry.id === 'hdr'
            ? 'Demo second image: input darkened to 45% exposure.'
            : entry.id === 'template-matching'
              ? 'Demo second image: a copy of the input, used to crop the template.'
              : 'Demo second image: input translated 12 pixels left with reflected borders.'
        // The inspected second image must be the exact image sent to OpenCV, including matching dimensions.
        if (secondary.width !== primary.width || secondary.height !== primary.height) {
          const src = document.createElement('canvas')
          src.width = secondary.width
          src.height = secondary.height
          src
            .getContext('2d')!
            .putImageData(
              new ImageData(new Uint8ClampedArray(secondary.pixels), secondary.width, secondary.height),
              0,
              0
            )
          const dst = document.createElement('canvas')
          dst.width = primary.width
          dst.height = primary.height
          dst.getContext('2d')!.drawImage(src, 0, 0, dst.width, dst.height)
          const image = dst.getContext('2d')!.getImageData(0, 0, dst.width, dst.height)
          secondary = { pixels: image.data, width: dst.width, height: dst.height }
        }
      } else secondary = undefined
      q('.source-note').textContent =
        `${filename} · ${original.width} × ${original.height} original → ${primary.width} × ${primary.height} processed.${entry.maxSide && entry.maxSide < Number(resolution.value) ? ` This experiment is limited to ${entry.maxSide} px on its longest side.` : ''}`
      inspectInput()
    }
    const invalidate = () => {
      revision++
      save.disabled = true
      this.viewer!.clearOutput()
      q('.result-note').textContent = ''
      q('.lab-stages').replaceChildren()
      q('.stage-note').textContent = ''
      delete this.dataset.stage
      if (busy) {
        message('Settings changed. Waiting for the current worker operation…', 'running')
        pending = auto.checked
      } else
        message(
          loaded
            ? 'Settings changed. Run to update the output.'
            : 'The engine loads on your first run. Your images stay in this browser.'
        )
      readiness()
    }
    const schedule = () => {
      clearTimeout(this.timer)
      if (this.worker && auto.checked) this.timer = setTimeout(process, 180)
    }
    const rectangle = () => {
      const overlay = q<HTMLElement>('.selection-rectangle'),
        second = q<HTMLSelectElement>('[name=inspect-input]').value === 'second'
      overlay.hidden =
        !('x' in params) || ('template-matching,seamless-cloning'.split(',').includes(entry.id) ? !second : second)
      if (!overlay.hidden) {
        overlay.style.left = `${Number(params.x)}%`
        overlay.style.top = `${Number(params.y)}%`
        overlay.style.width = `${Math.min(100 - Number(params.x), Number(params.width))}%`
        overlay.style.height = `${Math.min(100 - Number(params.y), Number(params.height))}%`
      }
    }
    const change = () => {
      rectangle()
      invalidate()
      schedule()
    }
    const process = () => {
      clearTimeout(this.timer)
      if (drag) {
        message('Release the selection to update the result.')
        return
      }
      if (loadingInputs.size) {
        message('Reading the selected file…', 'loading-input')
        return
      }
      if (missing().length) {
        readiness()
        return
      }
      const invalid = this.querySelector<HTMLInputElement>(
        '.lab-parameters input:invalid,.lab-parameters textarea:invalid'
      )
      if (invalid) {
        invalid.reportValidity()
        message('Check the highlighted parameter.', 'error')
        return
      }
      if (primary.width < 32 || primary.height < 32) {
        message('Choose an image at least 32 × 32 pixels for these experiments.', 'error')
        return
      }
      if (busy) {
        pending = true
        return
      }
      if (!this.worker) {
        this.worker = new LabWorker()
        this.worker.onmessage = ({ data }: MessageEvent<LabResponse>) => {
          busy = false
          stop.disabled = true
          loaded = true
          run.textContent = 'Run again'
          run.disabled = false
          if (inFlightRevision === revision) {
            if ('error' in data) {
              message(`Could not run this experiment: ${data.error}`, 'error')
              save.disabled = true
            } else {
              this.viewer!.setImage(1, data, data.native)
              message(
                `OpenCV ${data.version} · ${data.elapsed.toFixed(1)} ms · ${data.width} × ${data.height} · CPU WASM`,
                'ready'
              )
              q('.result-note').textContent = data.note
              this.dataset.result = String(data.id)
              save.disabled = false
              this.dataset.completedAlgorithm = data.algorithm
              const stages = data.stages ?? [],
                buttons = q('.lab-stages')
              buttons.replaceChildren()
              q('.stage-note').textContent = stages.length ? 'Final output of the complete recipe.' : ''
              if (stages.length) {
                const choices = [
                  ...stages,
                  { ...data, title: 'Result', description: 'Final output of the complete recipe.' }
                ]
                choices.forEach((stage, index) => {
                  const button = document.createElement('button')
                  button.type = 'button'
                  button.textContent = index === stages.length ? 'Result' : `${index + 1} · ${stage.title}`
                  button.setAttribute('aria-pressed', String(index === stages.length))
                  button.addEventListener('click', () => {
                    this.viewer!.setImage(1, stage, stage.native)
                    this.dataset.stage = String(index)
                    q('.stage-note').textContent = stage.description
                    buttons
                      .querySelectorAll('button')
                      .forEach((other) => other.setAttribute('aria-pressed', String(other === button)))
                  })
                  buttons.append(button)
                })
                this.dataset.stage = String(stages.length)
              }
            }
          } else if (!pending) message('Settings changed. Run to update the output.')
          if (pending) {
            pending = false
            process()
          }
          readiness()
        }
        this.worker.onerror = (event) => {
          event.preventDefault()
          busy = false
          pending = false
          loaded = false
          stop.disabled = true
          this.worker?.terminate()
          this.worker = undefined
          run.textContent = 'Load OpenCV and run'
          message(`The worker stopped: ${event.message}. You can run again to reload it.`, 'error')
          readiness()
        }
      }
      busy = true
      pending = false
      inFlightRevision = revision
      save.disabled = true
      stop.disabled = false
      run.textContent = 'Run again'
      message(loaded ? 'Processing in the worker…' : 'Loading the WebAssembly engine…', 'running')
      const request: LabRequest = {
        id: ++sequence,
        algorithm: entry.id,
        params: { ...params },
        pixels: new Uint8ClampedArray(primary.pixels),
        width: primary.width,
        height: primary.height,
        second: secondary ? { ...secondary, pixels: new Uint8ClampedArray(secondary.pixels) } : undefined,
        assets
      }
      const transfer: Transferable[] = [request.pixels.buffer]
      if (request.second) transfer.push(request.second.pixels.buffer)
      this.worker.postMessage(request, transfer)
    }
    const render = () => {
      drag = undefined
      this.dataset.selecting = 'false'
      q('.select-region').setAttribute('aria-pressed', 'false')
      if (original instanceof HTMLCanvasElement) original = drawSample(entry.sample)
      params = Object.fromEntries(entry.controls.map((control) => [control.key, control.value]))
      assets = {}
      q('.lab-parameters').replaceChildren()
      q('.lab-assets').replaceChildren()
      for (const input of loadingInputs) if (!input.isConnected) loadingInputs.delete(input)
      for (const control of entry.controls) {
        const label = document.createElement('label')
        label.className = `parameter${control.json ? ' json' : ''}`
        const title = document.createElement('span')
        title.textContent = control.label
        label.append(title)
        if (control.options) {
          const input = document.createElement('select')
          input.name = control.key
          for (const [value, text] of control.options) {
            const option = new Option(text, value)
            input.append(option)
          }
          input.value = String(control.value)
          input.addEventListener('change', () => {
            params[control.key] = input.value
            change()
          })
          label.append(input)
        } else if (control.json) {
          const input = document.createElement('textarea')
          input.name = control.key
          input.spellcheck = false
          input.value = String(control.value)
          input.addEventListener('input', () => {
            params[control.key] = input.value
            change()
          })
          label.append(input)
        } else {
          const wrap = document.createElement('div')
          wrap.className = 'parameter-values'
          const slider = document.createElement('input'),
            number = document.createElement('input')
          slider.type = 'range'
          number.type = 'number'
          number.name = control.key
          slider.setAttribute('aria-label', `${control.label} slider`)
          for (const input of [slider, number]) {
            input.min = String(control.min)
            input.max = String(control.max)
            input.step = String(control.step ?? 1)
            input.value = String(control.value)
          }
          // Keep exact model multipliers while enforcing odd/integer steps for native kernel controls.
          number.step = control.key === 'scale' && entry.id === 'dnn-inference' ? 'any' : String(control.step ?? 1)
          number.setAttribute('aria-label', control.label)
          slider.addEventListener('input', () => {
            number.value = slider.value
            params[control.key] = Number(slider.value)
            change()
          })
          number.addEventListener('input', () => {
            slider.value = number.value
            params[control.key] = number.value === '' ? NaN : Number(number.value)
            change()
          })
          if ('x' in params && 'width' in params && ['x', 'y', 'width', 'height'].includes(control.key)) {
            for (const input of [slider, number]) {
              input.min = control.key === 'x' || control.key === 'y' ? '0' : '0.1'
              input.max = control.key === 'x' || control.key === 'y' ? '99' : '100'
            }
            slider.step = '0.1'
            number.step = 'any'
          }
          number.required = true
          wrap.append(slider, number)
          label.append(wrap)
        }
        q('.lab-parameters').append(label)
      }
      for (const asset of entry.assets ?? []) {
        const label = document.createElement('label'),
          input = document.createElement('input'),
          name = document.createElement('span')
        label.className = 'file-button'
        label.textContent = asset.label
        input.type = 'file'
        input.accept = asset.accept
        input.name = asset.key
        name.className = 'asset-name'
        name.textContent = asset.required ? 'Required' : 'Built-in demo'
        label.append(input)
        let epoch = 0
        input.addEventListener('change', async () => {
          const file = input.files?.[0],
            token = ++epoch,
            algorithm = entry.id
          delete assets[asset.key]
          loadingInputs.add(input)
          invalidate()
          if (!file) {
            name.textContent = asset.required ? 'Required' : 'Built-in demo'
            loadingInputs.delete(input)
            change()
            return
          }
          try {
            if (file.size > 256 * 1024 * 1024) throw new Error('Use a model smaller than 256 MB in this preview.')
            const bytes = new Uint8Array(await file.arrayBuffer())
            if (token !== epoch || entry.id !== algorithm || !input.isConnected) return
            assets[asset.key] = bytes
            name.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`
            loadingInputs.delete(input)
            change()
          } catch (error) {
            if (token === epoch && input.isConnected)
              message(error instanceof Error ? error.message : String(error), 'error')
          } finally {
            if (token === epoch) {
              loadingInputs.delete(input)
              readiness()
            }
          }
        })
        const reset = document.createElement('button')
        reset.type = 'button'
        reset.textContent = asset.required ? 'Clear file' : 'Use bundled model'
        reset.addEventListener('click', () => {
          epoch++
          loadingInputs.delete(input)
          delete assets[asset.key]
          input.value = ''
          name.textContent = asset.required ? 'Required' : 'Built-in demo'
          change()
        })
        q('.lab-assets').append(label, name, reset)
      }
      q('.region-tools').hidden = !('x' in params && 'width' in params)
      q('.operation-note').textContent = entry.note
      q('.second-input').hidden = !entry.second
      q('.inspect-source').hidden = !entry.second
      if (!entry.second) q<HTMLSelectElement>('[name=inspect-input]').value = 'first'
      const guide = q<HTMLAnchorElement>('.guide-link')
      if (guide) {
        guide.href = entry.id.startsWith('cookbook-') ? `/cookbook/${entry.id.slice(9)}/` : `/algorithms/${entry.id}/`
        guide.textContent = entry.id.startsWith('cookbook-') ? 'Read the recipe →' : 'Read the visual explanation →'
      }
      q<HTMLAnchorElement>('.standalone-link').href = `/lab/?algorithm=${entry.id}`
      this.dataset.algorithm = entry.id
      prepare()
      rectangle()
      invalidate()
    }
    select?.addEventListener(
      'change',
      () => {
        entry = catalog.find((a) => a.id === select.value)!
        render()
        const url = new URL(location.href)
        url.searchParams.set('algorithm', entry.id)
        history.replaceState(null, '', url)
        schedule()
      },
      events
    )
    run.addEventListener('click', process, events)
    stop.addEventListener(
      'click',
      () => {
        this.worker?.terminate()
        this.worker = undefined
        busy = false
        pending = false
        loaded = false
        clearTimeout(this.timer)
        revision++
        stop.disabled = true
        run.textContent = 'Load OpenCV and run'
        message('Stopped. Run again to start a fresh worker.')
        readiness()
      },
      events
    )
    auto.addEventListener(
      'change',
      () => {
        if (!auto.checked) {
          clearTimeout(this.timer)
          pending = false
        } else schedule()
      },
      events
    )
    resolution.addEventListener(
      'change',
      () => {
        prepare()
        change()
      },
      events
    )
    q<HTMLSelectElement>('[name=inspect-input]').addEventListener(
      'change',
      () => {
        inspectInput()
        rectangle()
      },
      events
    )
    const upload = async (input: HTMLInputElement, isSecond: boolean) => {
      const file = input.files?.[0]
      if (!file) return
      const epoch = isSecond ? ++secondEpoch : ++uploadEpoch
      loadingInputs.add(input)
      invalidate()
      try {
        const bitmap = await createImageBitmap(file)
        if (epoch !== (isSecond ? secondEpoch : uploadEpoch) || !this.isConnected) {
          bitmap.close()
          return
        }
        if (bitmap.width < 32 || bitmap.height < 32 || bitmap.width * bitmap.height > 32_000_000) {
          bitmap.close()
          throw new Error('Choose an image at least 32 × 32 pixels and no larger than 32 megapixels.')
        }
        if (isSecond) {
          secondOriginal?.close()
          secondOriginal = bitmap
          secondFilename = file.name
        } else {
          if (original instanceof ImageBitmap) original.close()
          original = bitmap
          filename = file.name
        }
        loadingInputs.delete(input)
        prepare()
        change()
      } catch (error) {
        if (epoch === (isSecond ? secondEpoch : uploadEpoch))
          message(error instanceof Error ? error.message : 'This image could not be decoded. Try PNG or JPEG.', 'error')
      } finally {
        if (epoch === (isSecond ? secondEpoch : uploadEpoch)) {
          loadingInputs.delete(input)
          readiness()
        }
      }
    }
    q<HTMLInputElement>('[name=image]').addEventListener(
      'change',
      (event) => void upload(event.target as HTMLInputElement, false),
      events
    )
    q<HTMLInputElement>('[name=second]').addEventListener(
      'change',
      (event) => void upload(event.target as HTMLInputElement, true),
      events
    )
    q('.reset-image').addEventListener(
      'click',
      () => {
        uploadEpoch++
        loadingInputs.delete(q<HTMLInputElement>('[name=image]'))
        if (original instanceof ImageBitmap) original.close()
        original = drawSample(entry.sample)
        filename = 'Built-in sample'
        q<HTMLInputElement>('[name=image]').value = ''
        prepare()
        change()
      },
      events
    )
    q('.reset-second').addEventListener(
      'click',
      () => {
        secondEpoch++
        loadingInputs.delete(q<HTMLInputElement>('[name=second]'))
        secondOriginal?.close()
        secondOriginal = undefined
        secondFilename = ''
        q<HTMLInputElement>('[name=second]').value = ''
        prepare()
        change()
      },
      events
    )
    const selectionCanvas = q<HTMLCanvasElement>('canvas.input')
    q('.select-region').addEventListener(
      'click',
      () => {
        const enabled = this.dataset.selecting !== 'true'
        this.dataset.selecting = String(enabled)
        q('.select-region').setAttribute('aria-pressed', String(enabled))
        q<HTMLSelectElement>('[name=inspect-input]').value = ['template-matching', 'seamless-cloning'].includes(
          entry.id
        )
          ? 'second'
          : 'first'
        inspectInput()
        rectangle()
      },
      events
    )
    const locationInImage = (event: PointerEvent) => {
      const box = selectionCanvas.getBoundingClientRect()
      return {
        x: Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100)),
        y: Math.max(0, Math.min(100, ((event.clientY - box.top) / box.height) * 100))
      }
    }
    const updateSelection = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return
      const end = locationInImage(event),
        x = Math.min(99, Math.min(drag.x, end.x)),
        y = Math.min(99, Math.min(drag.y, end.y))
      const values = {
        x,
        y,
        width: Math.min(100 - x, Math.max(0.1, 200 / primary.width, Math.abs(end.x - drag.x))),
        height: Math.min(100 - y, Math.max(0.1, 200 / primary.height, Math.abs(end.y - drag.y)))
      }
      for (const [key, value] of Object.entries(values)) {
        params[key] = Math.round(value * 100) / 100
        const number = q<HTMLInputElement>(`.lab-parameters [name="${key}"]`)
        number.value = String(params[key])
        number.parentElement!.querySelector<HTMLInputElement>('[type=range]')!.value = number.value
      }
      rectangle()
    }
    selectionCanvas.addEventListener(
      'pointerdown',
      (event) => {
        if (this.dataset.selecting !== 'true' || event.button !== 0) return
        event.preventDefault()
        drag = { id: event.pointerId, ...locationInImage(event) }
        selectionCanvas.setPointerCapture(event.pointerId)
        invalidate()
        updateSelection(event)
      },
      events
    )
    selectionCanvas.addEventListener(
      'pointermove',
      (event) => {
        if (drag) {
          event.preventDefault()
          updateSelection(event)
        }
      },
      events
    )
    selectionCanvas.addEventListener(
      'pointerup',
      (event) => {
        if (!drag || drag.id !== event.pointerId) return
        updateSelection(event)
        drag = undefined
        selectionCanvas.releasePointerCapture(event.pointerId)
        change()
      },
      events
    )
    selectionCanvas.addEventListener(
      'pointercancel',
      () => {
        if (drag) {
          drag = undefined
          change()
        }
      },
      events
    )
    save.addEventListener(
      'click',
      () => {
        const link = document.createElement('a')
        link.download = `opencv-${this.dataset.completedAlgorithm}${this.dataset.stage ? `-stage-${this.dataset.stage}` : ''}.png`
        link.href = q<HTMLCanvasElement>('canvas.output').toDataURL('image/png')
        link.click()
      },
      events
    )
    this.abort.signal.addEventListener(
      'abort',
      () => {
        if (original instanceof ImageBitmap) original.close()
        secondOriginal?.close()
      },
      { once: true }
    )
    render()
    this.dataset.state = missing().length ? 'needs-input' : 'idle'
    if (!missing().length) status.textContent = 'The engine loads on your first run. Your images stay in this browser.'
  }
  disconnectedCallback() {
    clearTimeout(this.timer)
    this.worker?.terminate()
    this.worker = undefined
    this.viewer?.dispose()
    this.viewer = undefined
    this.abort?.abort()
  }
}
if (!customElements.get('image-lab')) customElements.define('image-lab', ImageLab)
