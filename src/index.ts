import type { ClassHandle, MainModule } from '../lib/opencv.js'
import { namespacePaths, classBases, nestedClasses } from '../lib/namespaces.js'
import type { NativeNamespaces, AugmentedModule } from '../lib/namespaces.js'
import { createValueAPI } from './values.js'
import { createGraphAPI } from './graph.js'
import { createStreamAPI, installGraphStreaming } from './streaming.js'
export { GraphStream, makeIterableSource } from './streaming.js'
export type { CVNamespace } from '../lib/namespaces.js'

/** All native functions, classes, constants and enums in this build. */
export type OpenCV = AugmentedModule & Omit<NativeNamespaces, 'gapi' | 'xfeatures2d'> & ReturnType<typeof createValueAPI> & ReturnType<typeof createGraphAPI> & {
  gapi: Omit<NativeNamespaces['gapi'], keyof ReturnType<typeof createGraphAPI> | 'wip'> & ReturnType<typeof createGraphAPI> & {
    wip: NativeNamespaces['gapi']['wip'] & ReturnType<typeof createStreamAPI>,
  },
  xfeatures2d: NativeNamespaces['xfeatures2d'] & { SIFT_create: MainModule['SIFT_create'] },
}
export * from './named.js'
export { initOpenCV } from './default.js'
export type * from './graph-types.js'
export { matFromArray, matFromImageData, toImageData, decodeImage, encodeImage } from './images.js'

/** Loading options; use wasmUrl with bundlers or wasmBinary for an in-memory binary. */
export type OpenCVOptions = {
  /** URL of the packaged WASM asset. In Node, the adjacent installed binary is loaded automatically when omitted. */
  wasmUrl?: string | URL,
  /** Already loaded WASM bytes, avoiding a separate asset fetch. */
  wasmBinary?: Uint8Array<ArrayBuffer>,
  /** Receive native standard-output messages. */
  print?: (text: string) => void,
  /** Receive native diagnostics and standard-error messages. */
  printErr?: (text: string) => void,
}

/**
 * Load an isolated CPU OpenCV WebAssembly instance in a browser, worker or Node.js.
 * @param options Asset-loading and native logging options.
 * @returns The fully typed API after native initialization. Release native objects with delete() or using; handles cannot be shared between instances.
 */
export const createOpenCV = async (options: OpenCVOptions = {}): Promise<OpenCV> => {
  // Keep the native module external so its relative WASM URL survives bundling.
  const { default: factory } = await import('./opencv.mjs')
  const cv = await factory({
    ...(options.wasmBinary ? { wasmBinary: options.wasmBinary } : {}),
    ...(options.wasmUrl ? { locateFile: () => String(options.wasmUrl) } : {}),
    ...(options.print ? { print: options.print } : {}),
    ...(options.printErr ? { printErr: options.printErr } : {}),
  })
  for (const value of Object.values(cv)) {
    if (typeof value === 'function' && value.prototype && typeof value.prototype.delete === 'function') {
      Object.defineProperty(value.prototype, Symbol.dispose, {
        configurable: true,
        value(this: ClassHandle) { if (!this.isDeleted()) this.delete() },
      })
    }
  }
  const module = cv as unknown as Record<string, unknown>
  for (const [name, base] of Object.entries(classBases)) {
    const derived = module[name], parent = module[base]
    if (typeof derived === 'function' && typeof parent === 'function') Object.setPrototypeOf(derived, parent)
  }
  for (const { native, parent, name } of nestedClasses) (module[parent] as Record<string, unknown>)[name] = module[native]
  for (const path of namespacePaths) {
    const segments = path.split('.')
    let parent = module
    for (const segment of segments.slice(0, -1)) parent = parent[segment] as Record<string, unknown>
    const prefix = path.replaceAll('.', '_') + '_'
    parent[segments.at(-1)!] = Object.fromEntries(Object.entries(cv)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value]))
  }
  const graph = createGraphAPI(cv)
  installGraphStreaming(cv)
  Object.assign(module.gapi as object, graph)
  Object.assign((module.gapi as { wip: object }).wip, createStreamAPI(cv))
  Object.assign(module.xfeatures2d as object, { SIFT_create: cv.SIFT_create })
  return Object.assign(cv, createValueAPI(cv), graph) as OpenCV
}
