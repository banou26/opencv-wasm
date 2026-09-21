import { createOpenCV, type OpenCV, type OpenCVOptions } from './index.js'

let initialization: Promise<OpenCV> | undefined
let instance: OpenCV | undefined
const bindings: ((cv: OpenCV) => void)[] = []

/** Register generated live exports before initialization. Internal to the package. */
export const registerDefaultBindings = (install: (cv: OpenCV) => void): void => { bindings.push(install) }

/** Get the initialized shared instance for image helper overloads. Internal to the package. */
export const getDefaultOpenCV = (): OpenCV => {
  if (!instance) throw new Error('Call and await initOpenCV() before using OpenCV image helpers.')
  return instance
}

/** Throw an actionable error if a named constructor, function or namespace is used before initialization. Internal. */
export const uninitializedExport = <T>(name: string): T => {
  const fail = () => { throw new Error(`Call and await initOpenCV() before using ${name}.`) }
  return new Proxy(function () {}, { apply: fail, construct: fail, get: fail }) as T
}

/**
 * Initialize the shared OpenCV instance used by named imports such as Mat and GaussianBlur.
 * @param options WASM asset and logging options. The first successful call configures this instance; later calls reuse it.
 * @returns The shared instance, also useful for image helpers and advanced memory access. Concurrent calls share one load; failed loads can be retried.
 * @remarks Await this before using any named native export. Importing the package alone never loads WASM. Each worker has its own instance. createOpenCV() still creates isolated instances and never rebinds these imports; do not mix their native handles.
 */
export const initOpenCV = (options: OpenCVOptions = {}): Promise<OpenCV> => {
  initialization ??= createOpenCV(options).then(cv => {
    for (const install of bindings) install(cv)
    instance = cv
    return cv
  }).catch(error => {
    initialization = undefined
    throw error
  })
  return initialization
}
