import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const website = fileURLToPath(new URL('../', import.meta.url)), editor = fileURLToPath(new URL('../../editor/', import.meta.url))
const children = [
  spawn('npm', ['run', 'dev'], { cwd: editor, env: { ...process.env, VITE_DOCS_URL: '/' }, stdio: 'inherit', detached: process.platform !== 'win32' }),
  // This parent owns both lifetimes, so Astro must remain in the foreground.
  spawn('node', ['node_modules/astro/bin/astro.mjs', 'dev', '--ignore-lock', '--host', '0.0.0.0', ...process.argv.slice(2)], { cwd: website, stdio: 'inherit', detached: process.platform !== 'win32' }),
]
let stopping = false
const stop = code => {
  if (stopping) return
  stopping = true
  for (const child of children) {
    try { if (process.platform === 'win32') child.kill(); else process.kill(-child.pid, 'SIGTERM') } catch {}
  }
  process.exitCode = code
}
for (const child of children) {
  child.on('error', error => { console.error(error); stop(1) })
  child.on('exit', code => stop(code ?? 0))
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
