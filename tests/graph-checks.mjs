/** Exercise native custom kernels and the serial stream lifecycle, including failure cleanup. */
export const runGraphChecks = async (cv, helpers) => {
  const owned = [], streams = [], passed = []
  const own = value => { if (!value) throw new Error('Native allocation failed'); owned.push(value); return value }
  const stream = value => { streams.push(value); return value }
  const assert = (value, message) => { if (!value) throw new Error(message) }
  const equal = (actual, expected) => assert(JSON.stringify(actual) === JSON.stringify(expected), `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  const rejected = async (run, message) => {
    let error
    try { await run() } catch (caught) { error = caught }
    assert(error !== undefined, message)
  }
  try {
    let fail = false, borrowed
    const operation = own(cv.gapi.op('test.split-affine', {
      inputs: 1, outputs: 2,
      outMeta: inputs => [inputs[0], inputs[0]],
    }))
    const kernel = own(cv.gapi.kernel(operation, (inputs, outputs) => {
      borrowed = [...inputs, ...outputs]
      if (fail) { inputs.length = 0; outputs.length = 0; throw new Error('intentional graph callback failure') }
      const input = inputs[0].data32F, first = outputs[0].data32F, second = outputs[1].data32F
      for (let i = 0; i < input.length; i++) { first[i] = input[i] + 2; second[i] = input[i] * 3 }
    }))
    const inputNode = own(new cv.GMat()), nodes = operation.on([inputNode]).map(own)
    const computation = own(new cv.GComputation(own(cv.GIn([inputNode])), own(cv.GOut(nodes))))
    const packages = own(cv.gapi.kernels(kernel, own(cv.gapi.core.cpu.kernels())))
    const options = own(cv.gapi.compile_args(packages))
    const input = own(helpers.matFromArray(cv, 1, 3, cv.CV_32FC1, [-1, 0, 2]))
    equal(cv.gapi.descr_of(input)[0], { depth: cv.CV_32F, channels: 1, size: { width: 3, height: 1 }, planar: false, dims: [] })
    const output = computation.apply([input], options).map(own)
    equal([...output[0].data32F], [1, 2, 4])
    equal([...output[1].data32F], [-3, 0, 6])
    assert(borrowed.every(handle => handle.isDeleted()), 'Custom kernel retained borrowed handles')
    fail = true
    await rejected(() => computation.apply([input], options), 'Graph callback error did not propagate')
    assert(borrowed.every(handle => handle.isDeleted()), 'Failed graph callback retained borrowed handles')
    fail = false
    const recovered = computation.apply([input], options).map(own)
    equal([...recovered[0].data32F], [1, 2, 4])
    equal([...recovered[1].data32F], [-3, 0, 6])
    passed.push('native TypeScript graph kernel and callback recovery')

    let released = 0, sourceClosed = 0
    const temporaryOptions = options.clone()
    const processor = stream(computation.compileStreaming(temporaryOptions))
    temporaryOptions.delete()
    async function* frames() {
      try {
        for (const value of [2, 5, 8]) {
          const frame = helpers.matFromArray(cv, 1, 1, cv.CV_32FC1, [value])
          yield { values: [frame], release: () => { frame.delete(); released++ } }
        }
      } finally { sourceClosed++ }
    }
    processor.setSource(frames())
    processor.start()
    const values = []
    for (;;) {
      const result = await processor.pull()
      if (!result) break
      result.forEach(own)
      values.push(result.map(mat => mat.data32F[0]))
    }
    equal(values, [[4, 6], [7, 15], [10, 24]])
    equal([released, sourceClosed, processor.running()], [3, 1, false])
    await processor.delete()
    await processor.delete()
    passed.push('async frame stream, changing dimensions and EOF cleanup')

    let cancelled = false, closed = 0
    const pendingStream = stream(computation.compileStreaming(options))
    pendingStream.setSource({
      pull: signal => new Promise(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve(null) }, { once: true })),
      close: () => { closed++ },
    })
    pendingStream.start()
    const pending = pendingStream.pull()
    await rejected(() => pendingStream.pull(), 'Concurrent stream pulls were accepted')
    await pendingStream.stop()
    equal(await pending, null)
    equal([cancelled, closed, pendingStream.running()], [true, 1, false])
    pendingStream.setSource([[input]])
    pendingStream.start()
    const resumed = await pendingStream.pull()
    resumed.forEach(own)
    equal([...resumed[0].data32F], [1, 2, 4])
    fail = true
    await pendingStream.stop()
    pendingStream.setSource([{ values: [input], release: () => { released++ } }])
    pendingStream.start()
    await rejected(() => pendingStream.pull(), 'Streaming callback failure did not propagate')
    assert(!pendingStream.running() && released === 4, 'Stream failure did not release its input')
    fail = false
    passed.push('stream cancellation, concurrent pull rejection and failure cleanup')

    const file = '/graph-source.avi'
    const writer = own(new cv.VideoWriter(file, cv.CAP_OPENCV_MJPEG, cv.VideoWriter_fourcc(77, 74, 80, 71), 10, { width: 32, height: 32 }, true))
    for (const value of [30, 80]) writer.write(own(new cv.Mat(32, 32, cv.CV_8UC3, [value, value, value, 0])))
    writer.release()
    const videoInput = own(new cv.GMat()), gray = own(cv.gapi.BGR2Gray(videoInput))
    const videoGraph = own(new cv.GComputation(own(cv.GIn([videoInput])), own(cv.GOut([gray]))))
    const videoStream = stream(videoGraph.compileStreaming())
    videoGraph.delete()
    videoStream.setSource(cv.gapi.wip.make_capture_src(file, cv.CAP_OPENCV_MJPEG))
    videoStream.start()
    const videoValues = []
    for (;;) {
      const frame = await videoStream.pull()
      if (!frame) break
      frame.forEach(own)
      videoValues.push(frame[0].data[0])
    }
    equal(videoValues, [30, 80])
    cv.FS.unlink(file)
    passed.push('video-file graph stream retains its computation')

    const sequence = own(cv.gapi.streaming.seq_id(videoInput))
    const legacySequence = own(cv.gapi.streaming.seqNo(videoInput))
    const timestamp = own(cv.gapi.streaming.timestamp(videoInput))
    const metadataGraph = own(new cv.GComputation(own(cv.GIn([videoInput])), own(cv.GOut([sequence, legacySequence, timestamp]))))
    const metadataStream = stream(metadataGraph.compileStreaming())
    metadataStream.setSource([[input], { values: [input], metadata: { seqId: 42n, timestamp: 1234567n } }, [input]])
    const before = BigInt(Date.now()) * 1000n
    metadataStream.start()
    const initial = await metadataStream.pull()
    assert(initial[0] === 0n && initial[1] === 0n && initial[2] >= before, 'Default frame metadata was incorrect')
    const supplied = await metadataStream.pull()
    assert(supplied[0] === 42n && supplied[1] === 42n && supplied[2] === 1234567n, 'Source metadata was not preserved')
    const subsequent = await metadataStream.pull()
    assert(subsequent[0] === 2n && subsequent[1] === 2n && subsequent[2] >= initial[2], 'Metadata did not update per frame')
    equal(await metadataStream.pull(), null)
    metadataStream.setSource([[input]])
    metadataStream.start()
    assert((await metadataStream.pull())[0] === 0n, 'Sequence did not reset for the new source')
    await metadataStream.stop()
    metadataStream.setSource([{ values: [input], metadata: { timestamp: 1n << 64n } }])
    metadataStream.start()
    await rejected(() => metadataStream.pull(), 'Out-of-range metadata was accepted')
    assert(!metadataStream.running(), 'Invalid metadata did not stop the stream')
    const direct = metadataGraph.applyWithMetadata([input], { seqId: -1n, timestamp: 99n })
    assert(direct[0] === -1n && direct[2] === 99n, 'Explicit graph metadata was not preserved')
    await rejected(() => metadataGraph.applyWithMetadata([input], { seqId: 1n << 64n, timestamp: 0n }), 'Native metadata silently truncated')
    passed.push('native frame sequence and timestamp operations with typed source metadata')

    const prototype = cv.GComputation.prototype, applyWithMetadata = prototype.applyWithMetadata
    let undelivered
    try {
      prototype.applyWithMetadata = Object.assign(function (...args) { undelivered = applyWithMetadata.apply(this, args); return undelivered }, applyWithMetadata)
      const failingRelease = stream(computation.compileStreaming(options))
      failingRelease.setSource([{ values: [input], release: () => { throw new Error('release failed') } }])
      failingRelease.start()
      await rejected(() => failingRelease.pull(), 'A throwing release callback was swallowed')
      assert(undelivered.length === 2 && undelivered.every(mat => mat.isDeleted()), 'Undelivered graph results leaked after release failed')
      assert(!failingRelease.running(), 'Release failure did not stop processing')
    } finally { prototype.applyWithMetadata = applyWithMetadata }
    passed.push('release callback failures dispose undelivered native results')
    return passed
  } finally {
    for (const value of streams.reverse()) await value.delete()
    for (const value of owned.reverse()) if (!value.isDeleted()) value.delete()
  }
}
