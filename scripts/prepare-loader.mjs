import { readFile, writeFile } from 'node:fs/promises'

// The pinned Emscripten async factory rejects both its returned promise and an
// internal ready promise when asset loading fails. Observe the latter so callers
// can catch the returned rejection and retry without an unhandled rejection.
const path = 'lib/opencv.mjs', source = await readFile(path, 'utf8')
const needle = 'var readyPromise=new Promise((resolve,reject)=>{readyPromiseResolve=resolve;readyPromiseReject=reject});'
const handled = needle + 'readyPromise.catch(()=>{});'
if (!source.includes(handled)) {
  if (source.split(needle).length !== 2) throw new Error('Review the Emscripten loader patch for this build')
  await writeFile(path, source.replace(needle, handled))
}
