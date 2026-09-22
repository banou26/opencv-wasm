import { useEffect, useState } from 'react'

type Theme = 'auto' | 'dark' | 'light'
const preference = (): Theme => {
  try { const stored = localStorage.getItem('starlight-theme'); return stored === 'light' || stored === 'dark' ? stored : 'auto' }
  catch { return 'auto' }
}
const apply = (theme: Theme) => {
  const resolved = theme === 'auto' ? matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark' : theme
  document.documentElement.dataset.theme = resolved
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#faf9fc' : '#121419')
}

/** Reuse the documentation's saved preference when moving between both apps. */
export const ThemeSelect = () => {
  const [theme, setTheme] = useState(preference)
  useEffect(() => {
    apply(theme)
    const system = matchMedia('(prefers-color-scheme: light)'), refresh = () => apply(theme)
    const storage = (event: StorageEvent) => { if (event.key === 'starlight-theme' || event.key === null) setTheme(preference()) }
    system.addEventListener('change', refresh); window.addEventListener('storage', storage)
    return () => { system.removeEventListener('change', refresh); window.removeEventListener('storage', storage) }
  }, [theme])
  return <select className="theme-select" aria-label="Color theme" value={theme} onChange={event => {
    const next = event.target.value as Theme
    setTheme(next)
    try { localStorage.setItem('starlight-theme', next === 'auto' ? '' : next) } catch { /* The current tab still follows the selected theme. */ }
  }}><option value="dark">Dark</option><option value="light">Light</option><option value="auto">Auto</option></select>
}
