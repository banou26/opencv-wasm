import type { CookbookVisual } from '../data/cookbook-visuals'

/** Navigate precomputed native snapshots without loading the processing engine. */
class CookbookWalkthrough extends HTMLElement {
  private timer?: ReturnType<typeof setTimeout>
  private cleanup?: AbortController
  connectedCallback() {
    this.cleanup?.abort()
    clearTimeout(this.timer)
    this.timer = undefined
    this.cleanup = new AbortController()
    const events = { signal: this.cleanup.signal }
    const q = <T extends Element = HTMLElement>(selector: string) => this.querySelector<T>(selector)!
    const visual = JSON.parse(q('[data-walkthrough-data]').textContent!) as CookbookVisual
    const buttons = [...this.querySelectorAll<HTMLButtonElement>('[data-step]')]
    const outputs = [...this.querySelectorAll<HTMLElement>('[data-output-step]')]
    const explanations = [...this.querySelectorAll<HTMLElement>('[data-explanation]')]
    const reference = q<HTMLSelectElement>('[name=walkthrough-reference]')
    const play = q<HTMLButtonElement>('[data-play]')
    const announcement = q('[data-announcement]')
    let step = 0,
      frame = 0
    const last = () => step === visual.stages.length - 1 && frame === visual.stages[step].length - 1
    const updateReference = () => {
      const previous =
        frame > 0 ? visual.stages[step][frame - 1] : step > 0 ? visual.stages[step - 1].at(-1)! : visual.input
      const image =
        reference.value === 'second' ? visual.second! : reference.value === 'original' ? visual.input : previous
      const label =
        reference.value === 'second'
          ? 'SECOND IMAGE'
          : reference.value === 'previous' && (step > 0 || frame > 0)
            ? 'PREVIOUS STEP PREVIEW'
            : 'STARTING IMAGE'
      const img = q<HTMLImageElement>('[data-reference-image]')
      img.src = image.src
      img.alt = image.description
      img.width = image.width
      img.height = image.height
      q('[data-reference-label]').textContent = label
      q('[data-reference-title]').textContent = image.title === 'Result' ? 'Previous step result' : image.title
      q('[data-reference-size]').textContent = `${image.width} × ${image.height}`
      q('[data-reference-description]').textContent = image.description
    }
    const select = (nextStep: number, nextFrame = 0) => {
      step = nextStep
      frame = nextFrame
      this.dataset.stage = String(step)
      this.dataset.frame = String(frame)
      buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === step)))
      outputs.forEach((output, i) => {
        output.hidden = i !== step
        output.querySelectorAll<HTMLElement>('[data-output-frame]').forEach((panel, j) => (panel.hidden = j !== frame))
        output
          .querySelectorAll('[data-frame-button]')
          .forEach((button, j) => button.setAttribute('aria-pressed', String(j === frame)))
      })
      explanations.forEach((panel, i) => (panel.hidden = i !== step))
      const counter = `STEP ${String(step + 1).padStart(2, '0')} / ${String(buttons.length).padStart(2, '0')}`
      q('[data-step-counter]').textContent = `${counter} · IMAGE ${frame + 1} / ${visual.stages[step].length}`
      q<HTMLButtonElement>('[data-previous]').disabled = step === 0 && frame === 0
      q<HTMLButtonElement>('[data-next]').disabled = last()
      this.style.setProperty(
        '--step-progress',
        `${((step + (frame + 1) / visual.stages[step].length) / buttons.length) * 100}%`
      )
      updateReference()
      if (this.dataset.playing !== 'true') announcement.textContent = `${counter}. ${visual.stages[step][frame].title}`
    }
    const stop = () => {
      clearTimeout(this.timer)
      this.timer = undefined
      this.dataset.playing = 'false'
      play.setAttribute('aria-pressed', 'false')
      play.setAttribute('aria-label', 'Play cookbook steps')
      play.textContent = '▷ Play steps'
    }
    const next = () => {
      if (frame + 1 < visual.stages[step].length) select(step, frame + 1)
      else if (step + 1 < buttons.length) select(step + 1)
    }
    buttons.forEach((button, i) => {
      button.addEventListener(
        'click',
        () => {
          stop()
          select(i)
        },
        events
      )
      button.addEventListener(
        'keydown',
        (event) => {
          const index =
            event.key === 'ArrowRight'
              ? (i + 1) % buttons.length
              : event.key === 'ArrowLeft'
                ? (i + buttons.length - 1) % buttons.length
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : -1
          if (index < 0) return
          event.preventDefault()
          stop()
          select(index)
          buttons[index].focus()
        },
        events
      )
    })
    outputs.forEach((output, i) =>
      output.querySelectorAll<HTMLButtonElement>('[data-frame-button]').forEach((button, j) => {
        button.addEventListener(
          'click',
          () => {
            stop()
            select(i, j)
          },
          events
        )
      })
    )
    reference.addEventListener('change', updateReference, events)
    q('[data-next]').addEventListener(
      'click',
      () => {
        stop()
        next()
      },
      events
    )
    q('[data-previous]').addEventListener(
      'click',
      () => {
        stop()
        if (frame > 0) select(step, frame - 1)
        else if (step > 0) select(step - 1, visual.stages[step - 1].length - 1)
      },
      events
    )
    play.addEventListener(
      'click',
      () => {
        if (this.timer !== undefined) {
          stop()
          return
        }
        select(0)
        this.dataset.playing = 'true'
        play.setAttribute('aria-pressed', 'true')
        play.setAttribute('aria-label', 'Pause cookbook steps')
        play.textContent = 'Ⅱ Pause'
        const advance = () => {
          if (last()) {
            stop()
            return
          }
          next()
          this.timer = setTimeout(advance, 4500)
        }
        this.timer = setTimeout(advance, 4500)
      },
      events
    )
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) stop()
      },
      events
    )
    stop()
    select(0)
  }
  disconnectedCallback() {
    clearTimeout(this.timer)
    this.timer = undefined
    this.cleanup?.abort()
  }
}
if (!customElements.get('cookbook-walkthrough')) customElements.define('cookbook-walkthrough', CookbookWalkthrough)
