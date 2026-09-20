import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { parse } from 'parse5'

const root = new URL('../dist/', import.meta.url)
const files = (await fs.readdir(root, { recursive: true })).filter(p => p.endsWith('.html'))
assert.ok(files.length > 2000, 'Build the complete reference before checking it')
const pages = new Map(), broken = []
let internalLinks = 0
const visit = (node, fn) => { fn(node); for (const child of node.childNodes ?? []) visit(child, fn) }
for (const file of files) {
  const html = await fs.readFile(new URL(file, root), 'utf8'), ids = new Set(), links = []
  visit(parse(html), node => {
    const attrs = Object.fromEntries((node.attrs ?? []).map(a => [a.name, a.value]))
    if (attrs.id) ids.add(attrs.id)
    if (node.tagName === 'a' && attrs.href) links.push(attrs.href)
  })
  pages.set('/' + file, { ids, links })
}
for (const [file, page] of pages) for (const href of page.links) {
  if (/^(https?:|mailto:|tel:|data:)/.test(href)) continue
  internalLinks++
  const url = new URL(href, 'https://docs.invalid' + file.replace(/index\.html$/, ''))
  let pathname = decodeURIComponent(url.pathname)
  if (pathname.endsWith('/')) pathname += 'index.html'
  else if (!path.extname(pathname)) pathname += '/index.html'
  const target = pages.get(pathname)
  if (!target) {
    try { await fs.access(new URL(pathname.slice(1), root)) } catch { broken.push({ file, href, reason: 'missing path' }) }
  } else if (url.hash && !target.ids.has(decodeURIComponent(url.hash.slice(1)))) broken.push({ file, href, reason: 'missing fragment' })
}
const data = JSON.parse(await fs.readFile(new URL('../src/data/api.generated.json', import.meta.url)))
assert.ok(data.entries.find(e => e.name === 'CLAHE' && e.kind === 'class' && e.module === 'imgproc'), 'Abstract native classes must retain method documentation')
assert.ok(data.entries.find(e => e.name === 'GaussianBlur').sources[0].includes('/5.0.0/'), 'Native entries must link to pinned source')
for (const entry of data.entries) assert.ok(pages.has(`/api/${entry.slug}/index.html`), `Missing reference: ${entry.slug}`)
if (broken.length) { console.error(JSON.stringify(broken.slice(0, 40), null, 2)); throw new Error(`${broken.length} broken internal links`) }
console.log(`Checked ${files.length} pages and ${internalLinks} internal links and fragments; external URLs are not fetched`)
