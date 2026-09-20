import type { GraphValue } from '../lib/opencv.js'

/** Signed 64-bit source metadata. Timestamps are microseconds since the Unix epoch by default. */
export type GraphFrameMetadata = {
  /** Source sequence identifier. GraphStream starts at zero and increments after each frame. */
  seqId: bigint,
  /** Source timestamp in microseconds. GraphStream defaults to the current Unix time. */
  timestamp: bigint,
}

/** One graph input batch. A release callback transfers responsibility for temporary input handles. */
export type GraphFrame = readonly GraphValue[] | {
  /** Runtime inputs in the order declared by GIn. */
  values: readonly GraphValue[],
  /** Called after execution, including failure, to release this frame's temporary input handles. */
  release?: () => undefined,
  /** Override either automatically generated sequence or timestamp metadata for this frame. */
  metadata?: Partial<GraphFrameMetadata>,
}

/** Pull frames serially. Honor the abort signal when waiting for an external producer. */
export type GraphSource = {
  /** Produce the next frame or null at end of stream. Resolve promptly when the signal is aborted. */
  pull(signal: AbortSignal): GraphFrame | null | Promise<GraphFrame | null>,
  /** Release producer resources after EOF, cancellation or failure. */
  close?(): void | Promise<void>,
}

/** Iterables borrow their values unless a frame supplies a release callback. */
export type GraphFrames = Iterable<GraphFrame> | AsyncIterable<GraphFrame>

/** Serial frame executor. Dispose with await using or await delete(). */
export type GraphStreamHandle = {
  /** Set the next source while stopped. Stop and close a previous source before replacing it. */
  setSource(source: GraphSource | GraphFrames): void,
  /** Start the configured source. Work begins on pull(); frames are not prefetched. */
  start(): void,
  /** Return whether this executor is accepting frames. */
  running(): boolean,
  /** Execute one frame and return owned outputs, or null at EOF. Concurrent pulls are rejected. Dispose output handles, including those in arrays. */
  pull(): Promise<GraphValue[] | null>,
  /** Abort pending input reads, wait for them to settle and close the source. */
  stop(): Promise<void>,
  /** Idempotently stop and release the retained graph and compilation options. */
  delete(): Promise<void>,
  /** Release this executor at the end of an await using scope. */
  [Symbol.asyncDispose](): Promise<void>,
}

/** File metadata in the instance's in-memory filesystem. */
export type FileStat = {
  /** Filesystem device identifier. */
  dev: number,
  /** File's inode identifier. */
  ino: number,
  /** File kind and permission bits; pass to isFile() or isDir(). */
  mode: number,
  /** Number of hard links. */
  nlink: number,
  /** Owning user identifier. */
  uid: number,
  /** Owning group identifier. */
  gid: number,
  /** Device identifier for a special file. */
  rdev: number,
  /** File size in bytes. */
  size: number,
  /** Last access time. */
  atime: Date,
  /** Last content modification time. */
  mtime: Date,
  /** Last metadata change time. */
  ctime: Date,
  /** Preferred block size in bytes. */
  blksize: number,
  /** Allocated block count. */
  blocks: number,
}

/** Files used by native codecs, model readers and algorithms belong to this instance. Paths refer to its virtual filesystem, including in Node. */
export type VirtualFileSystem = {
  /** Create or replace a virtual file from UTF-8 text or bytes. Parent directories must exist; flags can select append behavior. */
  writeFile(path: string, data: string | ArrayBufferView, options?: {
    /** File open flags, such as w or a. Defaults to w. */
    flags?: string,
    /** Encoding used for string input; byte views are copied directly. */
    encoding?: 'utf8' | 'binary',
  }): void,
  /** Read a virtual file into an independent byte array. */
  readFile(path: string, options?: {
    /** Return raw bytes. */
    encoding?: 'binary',
    /** File open flags. Defaults to r. */
    flags?: string,
  }): Uint8Array<ArrayBuffer>,
  /** Read a virtual file and decode it as UTF-8 text. */
  readFile(path: string, options: {
    /** Decode bytes as UTF-8. */
    encoding: 'utf8',
    /** File open flags. Defaults to r. */
    flags?: string,
  }): string,
  /** Create one directory; its parent must exist. The internal filesystem node return value is opaque. */
  mkdir(path: string, mode?: number): unknown,
  /** Create a directory and any missing parent directories. */
  mkdirTree(path: string, mode?: number): void,
  /** Remove an empty directory. */
  rmdir(path: string): void,
  /** List directory entry names, including . and ... */
  readdir(path: string): string[],
  /** Remove a file or symbolic-link directory entry. */
  unlink(path: string): void,
  /** Move or rename an entry within this virtual filesystem. */
  rename(from: string, to: string): void,
  /** Read file metadata, following symbolic links. */
  stat(path: string): FileStat,
  /** Read metadata for the entry itself without following its final symbolic link. */
  lstat(path: string): FileStat,
  /** Return this instance's current virtual working directory. */
  cwd(): string,
  /** Change this instance's current virtual working directory. */
  chdir(path: string): void,
  /** Set permission bits for a virtual filesystem entry. */
  chmod(path: string, mode: number): void,
  /** Test whether a FileStat.mode value denotes a regular file. */
  isFile(mode: number): boolean,
  /** Test whether a FileStat.mode value denotes a directory. */
  isDir(mode: number): boolean,
}

declare const RuntimeExports: {
  /** This instance's in-memory filesystem. Copy host files into it before passing paths to native APIs. */
  FS: VirtualFileSystem,
  /** Unsigned 8-bit WASM memory view. Reacquire after native memory growth. */
  HEAPU8: Uint8Array<ArrayBuffer>,
  /** Signed 8-bit WASM memory view. Reacquire after native memory growth. */
  HEAP8: Int8Array<ArrayBuffer>,
  /** Unsigned 16-bit WASM memory view. Reacquire after native memory growth. */
  HEAPU16: Uint16Array<ArrayBuffer>,
  /** Signed 16-bit WASM memory view. Reacquire after native memory growth. */
  HEAP16: Int16Array<ArrayBuffer>,
  /** Signed 32-bit WASM memory view. Reacquire after native memory growth. */
  HEAP32: Int32Array<ArrayBuffer>,
  /** Unsigned 32-bit WASM memory view. Reacquire after native memory growth. */
  HEAPU32: Uint32Array<ArrayBuffer>,
  /** 32-bit floating-point WASM memory view. Reacquire after native memory growth. */
  HEAPF32: Float32Array<ArrayBuffer>,
  /** 64-bit floating-point WASM memory view. Reacquire after native memory growth. */
  HEAPF64: Float64Array<ArrayBuffer>,
}
