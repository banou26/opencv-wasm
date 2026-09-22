import { copyFile, mkdir, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const names = ['market-pan', 'street-busy', 'long-pan', 'cart-parallax', 's1-day-pan', 's1-day-busy']
const output = new URL('../public/samples/', import.meta.url)
await mkdir(output, { recursive: true })
for (const name of names) {
  const source = new URL(`../../cadence/work/peek/${name}.mp4`, import.meta.url)
  try { await access(source) }
  catch { console.log(`Missing optional scene: ${fileURLToPath(source)}`); continue }
  await copyFile(source, new URL(`${name}.mp4`, output))
  console.log(`Copied ${name}`)
}
