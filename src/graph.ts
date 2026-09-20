import type { MainModule, Mat, GOperation, GTypedOperation, GraphValue, GraphMetadataFunction, GraphTypedMetadataFunction, GraphKernelFunction, GraphTypedKernelFunction, GKernelPackage, GCompileArg, gapi_streaming_queue_capacity, gapi_GNetPackage, gapi_dnn_Params } from '../lib/opencv.js'
import type { GraphPorts, TypedGraphSignature, TypedGraphOperation, TypedGraphKernel } from './graph-types.js'

/** TypeScript conveniences for the native CPU graph API and Python's graph factories. */
export const createGraphAPI = (cv: MainModule) => {
  /** Factories for typed array graph placeholders. Runtime inputs and outputs are ordinary JavaScript arrays. */
  const GArray = {
    /** Create an owned graph placeholder for an array of boolean values. */
    Bool: () => new cv.GArray_bool(),
    /** Create an owned graph placeholder for an array of signed 32-bit integer values. */
    Int: () => new cv.GArray_int(),
    /** Create an owned graph placeholder for an array of signed 64-bit bigint values. */
    Int64: () => new cv.GArray_int64_t(),
    /** Create an owned graph placeholder for an array of unsigned 64-bit bigint values. */
    UInt64: () => new cv.GArray_uint64_t(),
    /** Create an owned graph placeholder for an array of double-precision number values. */
    Double: () => new cv.GArray_double(),
    /** Create an owned graph placeholder for an array of single-precision number values. */
    Float: () => new cv.GArray_float(),
    /** Create an owned graph placeholder for an array of string values. */
    String: () => new cv.GArray_string(),
    /** Create an owned graph placeholder for an array of integer point values. */
    Point: () => new cv.GArray_Point2i(),
    /** Create an owned graph placeholder for an array of two-dimensional floating-point point values. */
    Point2f: () => new cv.GArray_Point2f(),
    /** Create an owned graph placeholder for an array of three-dimensional floating-point point values. */
    Point3f: () => new cv.GArray_Point3f(),
    /** Create an owned graph placeholder for an array of integer image extent values. */
    Size: () => new cv.GArray_Size(),
    /** Create an owned graph placeholder for an array of integer rectangle values. */
    Rect: () => new cv.GArray_Rect(),
    /** Create an owned graph placeholder for an array of matrix values. */
    Mat: () => new cv.GArray_Mat(),
    /** Create an owned graph placeholder for an array of four-component scalar values. */
    Scalar: () => new cv.GArray_Scalar(),
    /** Create an owned graph placeholder for an array of drawing primitive values. */
    Prim: () => new cv.GArray_Prim(),
  }
  /** Factories for single-value graph placeholders. Each returned node is an owned native handle. */
  const GOpaque = {
    /** Create an owned graph placeholder for one boolean value. */
    Bool: () => new cv.GOpaque_bool(),
    /** Create an owned graph placeholder for one signed 32-bit integer value. */
    Int: () => new cv.GOpaque_int(),
    /** Create an owned graph placeholder for one signed 64-bit bigint value. */
    Int64: () => new cv.GOpaque_int64_t(),
    /** Create an owned graph placeholder for one unsigned 64-bit bigint value. */
    UInt64: () => new cv.GOpaque_uint64_t(),
    /** Create an owned graph placeholder for one double-precision number value. */
    Double: () => new cv.GOpaque_double(),
    /** Create an owned graph placeholder for one single-precision number value. */
    Float: () => new cv.GOpaque_float(),
    /** Create an owned graph placeholder for one string value. */
    String: () => new cv.GOpaque_string(),
    /** Create an owned graph placeholder for one integer point value. */
    Point: () => new cv.GOpaque_Point(),
    /** Create an owned graph placeholder for one two-dimensional floating-point point value. */
    Point2f: () => new cv.GOpaque_Point2f(),
    /** Create an owned graph placeholder for one three-dimensional floating-point point value. */
    Point3f: () => new cv.GOpaque_Point3f(),
    /** Create an owned graph placeholder for one integer image extent value. */
    Size: () => new cv.GOpaque_Size(),
    /** Create an owned graph placeholder for one integer rectangle value. */
    Rect: () => new cv.GOpaque_Rect(),
  }
  /** Collect runtime graph inputs in GIn order. Values are borrowed, without copying or transferring ownership. */
  const gin = (...values: GraphValue[]) => values
  /** Read matrix layouts for graph metadata callbacks; returns ordinary values with no disposal requirement. */
  const descr_of = (...values: Mat[]) => values.map(value => cv.gapi_matDesc(value))
  /**
   * Define a custom native operation with exact matrix, scalar, array and opaque port types.
   * @param id Unique operation identifier, used to match the operation to a kernel package.
   * @param signature Ordered input/output port tuples. Matrix outputs require outMeta to specify their allocation layout.
   * @returns An owned operation; connect it with on(), then supply its kernel when compiling the graph.
   */
  function op<const Inputs extends GraphPorts, const Outputs extends GraphPorts>(id: string, signature: TypedGraphSignature<Inputs, Outputs>): TypedGraphOperation<Inputs, Outputs>
  /**
   * Define a custom native operation whose inputs and outputs are all matrices.
   * @param id Unique operation identifier, used to match a kernel package.
   * @param signature Matrix input/output counts and a synchronous output-layout callback.
   * @returns An owned operation handle; dispose it with using or delete().
   */
  function op(id: string, signature: { inputs: number, outputs: number, outMeta: GraphMetadataFunction }): GOperation
  function op(id: string, signature: { inputs: number | GraphPorts, outputs: number | GraphPorts, outMeta?: unknown }): GOperation | GTypedOperation {
    if (typeof signature.inputs === 'number' && typeof signature.outputs === 'number') return new cv.GOperation(id, signature.inputs, signature.outputs, signature.outMeta as GraphMetadataFunction)
    if (typeof signature.inputs === 'number' || typeof signature.outputs === 'number') throw new TypeError('Graph input and output signatures must both use counts or both use port tuples')
    return new cv.GTypedOperation(id, signature.inputs, signature.outputs, signature.outMeta as GraphTypedMetadataFunction | undefined)
  }
  /**
   * Implement a typed operation with a synchronous CPU callback.
   * @param operation Operation whose port tuples determine the callback types.
   * @param run Fill preallocated matrix outputs and assign other output slots. Native input/output handles are borrowed until the callback returns. Async functions are rejected.
   * @returns An owned kernel package to pass to compile_args().
   */
  function kernel<Inputs extends GraphPorts, Outputs extends GraphPorts>(operation: TypedGraphOperation<Inputs, Outputs>, run: TypedGraphKernel<NoInfer<Inputs>, NoInfer<Outputs>>): GKernelPackage
  /**
   * Implement a matrix-only operation with a synchronous CPU callback.
   * @param operation Operation describing the matrix inputs and outputs.
   * @param run Write the preallocated outputs without resizing; callback matrices are borrowed until return.
   * @returns An owned kernel package to pass to compile_args().
   */
  function kernel(operation: GOperation, run: GraphKernelFunction): GKernelPackage
  function kernel(operation: GOperation | GTypedOperation, run: GraphKernelFunction | GraphTypedKernelFunction): GKernelPackage {
    return operation.kernel(run as GraphKernelFunction & GraphTypedKernelFunction)
  }
  /** Combine native kernel packages into a new owned package. With no arguments, return an empty package. */
  const kernels = (...packages: GKernelPackage[]) => {
    let result = cv.gapi_emptyKernels()
    try {
      for (const pkg of packages) {
        const combined = cv.gapi_combine(result, pkg)
        result.delete()
        result = combined
  }
      return result
    } catch (error) { result.delete(); throw error }
  }
  /** Package named DNN network configurations for graph compilation. Tags must be unique; dispose the returned package. */
  const networks = (...parameters: gapi_dnn_Params[]) => cv.gapi_networks(parameters)
  /** Collect kernels, networks and native compilation options into an owned GCompileArgs vector that retains their configurations. */
  const compile_args = (...values: (GKernelPackage | GCompileArg | gapi_streaming_queue_capacity | gapi_GNetPackage)[]) => {
    const result = new cv.GCompileArgs()
    try {
      for (const value of values) {
        if (value instanceof cv.GCompileArg) result.push_back(value)
        else {
          const arg = value instanceof cv.gapi_streaming_queue_capacity ? cv.GCompileArg.fromQueueCapacity(value)
            : value instanceof cv.gapi_GNetPackage ? cv.GCompileArg.fromNetworks(value)
              : new cv.GCompileArg(value)
          try { result.push_back(arg) } finally { arg.delete() }
        }
  }
      return result
    } catch (error) { result.delete(); throw error }
  }
  return {
    /** Create owned graph placeholders for typed arrays of runtime values. */
    GArray,
    /** Create owned graph placeholders for single typed runtime values. */
    GOpaque,
    /** Collect borrowed runtime inputs in the order declared by GIn. */
    gin,
    /** Read matrix layouts as plain metadata values. */
    descr_of,
    /** Define a custom native operation with typed port tuples or matrix counts. Matrix outputs require an outMeta layout callback. Returns an owned operation. */
    op,
    /** Implement a custom operation with a synchronous CPU callback. Handles are borrowed until return; fill matrix outputs and assign other output slots. Returns an owned kernel package. */
    kernel,
    /** Combine kernel packages into a new owned package. */
    kernels,
    /** Package DNN network configurations with unique tags for graph compilation. Returns an owned package. */
    networks,
    /** Collect kernels, networks and compilation options in a new owned argument vector. */
    compile_args,
    /** Declare the graph's ordered input nodes; dispose the returned protocol handle. */
    GIn: cv.GIn,
    /** Declare the graph's ordered output nodes; dispose the returned protocol handle. */
    GOut: cv.GOut,
  }
}
