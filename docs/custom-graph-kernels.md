# Typed custom graph kernels

`cv.gapi.op` can define heterogeneous native G-API operations using literal port tuples. TypeScript infers the exact input/output nodes, callback values and metadata types. The count-based matrix API remains available.

```ts
using operation = cv.gapi.op('app.sum', {
  inputs: ['array:int', 'opaque:string'],
  outputs: ['scalar', 'opaque:string'],
})
using kernel = cv.gapi.kernel(operation, (inputs, outputs) => {
  const sum = inputs[0].reduce((a, b) => a + b, 0)
  outputs[0] = [sum, 0, 0, 0]
  outputs[1] = `${inputs[1]}: ${sum}`
})
using numbers = cv.GArray.Int()
using label = cv.GOpaque.String()
const nodes = operation.on([numbers, label])
using scalar = nodes[0]
using text = nodes[1]
using inputs = cv.GIn([numbers, label])
using outputs = cv.GOut([scalar, text])
using graph = new cv.GComputation(inputs, outputs)
using options = cv.gapi.compile_args(kernel)
const result = graph.apply([[2, 3, 5], 'total'], options)
// result: [[10, 0, 0, 0], 'total: 10']
```

| Port | Callback value |
| --- | --- |
| `mat` | Native `Mat` |
| `scalar` | Four-number `Scalar` tuple |
| `opaque:bool`, `opaque:string` | `boolean`, `string` |
| `opaque:int` | Signed 32-bit integer as `number` |
| `opaque:int64`, `opaque:uint64` | Signed or unsigned 64-bit `bigint` |
| `opaque:float`, `opaque:double` | `number` |
| `opaque:point`, `opaque:point2f`, `opaque:point3f`, `opaque:size`, `opaque:rect` | Typed geometry values |
| `array:` plus any opaque element name above | JavaScript array of those values |
| `array:mat`, `array:scalar`, `array:prim` | Array of matrices, scalar tuples or `GDrawPrim` handles |

Matrix outputs require an `outMeta` callback. It receives a descriptor for each matrix input and `null` for other ports; return a matrix descriptor or `null` in each output position. Non-matrix signatures can omit metadata entirely. For example:

```ts
using operation = cv.gapi.op('app.invert-with-label', {
  inputs: ['mat', 'opaque:string'],
  outputs: ['mat', 'opaque:string'],
  outMeta: inputs => [inputs[0], null],
})
using kernel = cv.gapi.kernel(operation, (inputs, outputs) => {
  cv.bitwise_not(inputs[0], outputs[0])
  outputs[1] = inputs[1]
})
```

Callbacks are synchronous. Write the preallocated matrix outputs without resizing them; assign scalar, array and opaque output slots. A replacement matrix must have the declared size and type and is copied into the output allocation. Native matrix and drawing-primitive handles passed to callbacks are borrowed until return. Retain a separate handle if needed afterwards; use `mat_clone()` when an independent pixel copy is required. Application-created native handles remain application-owned.

The bridge checks output types before native conversion, including tuple shapes, geometry fields, 32-bit and 64-bit bounds, and released handles. Empty arrays are supported. Callback exceptions and invalid output values become execution errors. Borrowed handles are released even if a callback alters its input/output arrays. Writes to matrix storage are immediate, so callback failure does not roll them back.

Graph results are caller-owned. Release native handles in results, including matrices and drawing primitives nested in arrays. Plain geometry values, strings, numbers and scalar tuples require no disposal. Use unique operation IDs and create a new computation when changing its kernel configuration.

These kernels execute on the native CPU graph backend in Node and browsers. They do not emulate Python decorators, arbitrary Python objects, GPU kernels or native parallel graph streaming.
