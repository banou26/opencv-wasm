import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'

const root = resolve('.')
const mime = { '.wasm': 'application/wasm', '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html' }
createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  if (path === '/') {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><html><head><title>OpenCV browser verification</title></head><body><canvas id="output"></canvas></body></html>')
    return
  }
  const file = resolve(root, '.' + path)
  if (!file.startsWith(root + sep)) { response.writeHead(404).end(); return }
  try {
    response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream')
    response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
}).listen(47831, '127.0.0.1')
