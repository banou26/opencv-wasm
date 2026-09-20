declare module '*.mjs' {
  const factory: (options?: {
    wasmBinary?: Uint8Array<ArrayBuffer>,
    locateFile?: (path: string, prefix: string) => string,
    print?: (text: string) => void,
    printErr?: (text: string) => void,
  }) => Promise<import('../lib/opencv.js').MainModule>
  export default factory
}
