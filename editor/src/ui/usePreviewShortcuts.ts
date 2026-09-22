import { useEffect } from 'react'
import type { RefObject } from 'react'
import { useEditor } from './store'
import type { FramePlayerHandle } from './FramePlayer'

/** Step the visible preview in its own frame rate, including a paused output movie. */
export const usePreviewShortcuts = (player: RefObject<FramePlayerHandle | null>) => {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
      const direction = event.key === '<' || event.key === ',' ? -1 : event.key === '>' || event.key === '.' ? 1 : 0
      if (!direction) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('textarea, select, input:not([type="range"]), [role="textbox"]'))) return
      const state = useEditor.getState()
      if (state.inspectorView === 'movie') {
        if (!player.current?.step(direction)) return
        event.preventDefault()
        event.stopPropagation()
      } else if (state.ready && !state.fatal && state.busy !== 'load' && state.busy !== 'bake') {
        event.preventDefault()
        const next = direction < 0 ? Math.ceil(state.frame) - 1 : Math.floor(state.frame) + 1
        useEditor.setState({ frame: Math.max(0, Math.min((state.source?.frameCount ?? state.generatedFrames) - 1, next)) })
      }
    }
    window.addEventListener('keydown', keydown, { capture: true })
    return () => window.removeEventListener('keydown', keydown, { capture: true })
  }, [player])
}
