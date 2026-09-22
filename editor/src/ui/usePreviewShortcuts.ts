import { useEffect } from 'react'
import type { RefObject } from 'react'
import { useEditor } from './store'

/** Step the visible preview in its own frame rate, including a paused output movie. */
export const usePreviewShortcuts = (player: RefObject<HTMLVideoElement | null>) => {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
      const direction = event.key === '<' || event.key === ',' ? -1 : event.key === '>' || event.key === '.' ? 1 : 0
      if (!direction) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('textarea, select, input:not([type="range"]), [role="textbox"]'))) return
      const state = useEditor.getState()
      if (!state.ready || state.fatal || state.busy === 'load' || state.busy === 'bake') return
      if (state.inspectorView === 'movie') {
        const video = player.current, movie = state.movie
        if (!video || !movie || !video.readyState || !movie.count) return
        event.preventDefault()
        video.pause()
        const current = Math.min(movie.count - 1, Math.floor(video.currentTime * movie.fps + 1e-6))
        const next = Math.max(0, Math.min(movie.count - 1, current + direction))
        // Seek inside the frame's presentation interval to avoid timestamp rounding
        // selecting its neighbor. This uses the rendered fps, not the source fps.
        video.currentTime = (next + 0.5) / movie.fps
      } else if (state.source) {
        event.preventDefault()
        const next = direction < 0 ? Math.ceil(state.frame) - 1 : Math.floor(state.frame) + 1
        useEditor.setState({ frame: Math.max(0, Math.min(state.source.frameCount - 1, next)) })
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [player])
}
