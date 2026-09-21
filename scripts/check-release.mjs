import { appendFile, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

/**
 * Check the exact package version on the public npm registry. Only a 404 permits
 * publishing; network failures and other registry errors stop the release.
 * The optional fetch implementation lets tests exercise those responses offline.
 */
export async function shouldPublish({ name, version }, fetchMetadata = fetch) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
  const response = await fetchMetadata(url, { signal: AbortSignal.timeout(30_000) })
  if (response.status === 404) return true
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status} for ${name}@${version}`)
  const metadata = await response.json()
  if (metadata.name !== name || metadata.version !== version) {
    throw new Error(`npm registry returned unexpected metadata for ${name}@${version}`)
  }
  return false
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const publish = await shouldPublish(manifest)
  const output = `publish=${publish ? 'yes' : 'no'}\n`
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output)
  console.log(`${manifest.name}@${manifest.version}: ${publish ? 'not yet published' : 'already published, skipping'}`)
}
