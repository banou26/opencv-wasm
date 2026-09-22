/** WebGPU presentation owns one uploaded RGBA texture, independent of OpenCV's cache. */
export class Presenter {
  private texture: GPUTexture | null = null
  private pipeline: GPURenderPipeline
  private sampler: GPUSampler
  private context: GPUCanvasContext

  private constructor(private canvas: OffscreenCanvas, private device: GPUDevice) {
    const context = canvas.getContext('webgpu')
    if (!context) throw new Error('WebGPU canvas presentation is unavailable')
    this.context = context
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: 'opaque' })
    const module = device.createShaderModule({ code: `
      struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
      @vertex fn vertex(@builtin(vertex_index) index: u32) -> Vertex {
        let positions = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
        let p = positions[index]; var out: Vertex;
        out.position = vec4f(p, 0., 1.); out.uv = vec2f((p.x + 1.) * .5, (1. - p.y) * .5); return out;
      }
      @group(0) @binding(0) var image: texture_2d<f32>;
      @group(0) @binding(1) var imageSampler: sampler;
      @fragment fn fragment(input: Vertex) -> @location(0) vec4f { return vec4f(textureSample(image, imageSampler, input.uv).rgb, 1.); }
    ` })
    this.pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vertex' }, fragment: { module, entryPoint: 'fragment', targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
    this.sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' })
  }

  /** Fail explicitly instead of silently changing the rendering backend. */
  static async create(canvas: OffscreenCanvas, lost: (message: string) => void): Promise<{ presenter: Presenter; adapter: string }> {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable. Open Cadence in desktop Chrome on your graphics session.')
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('No WebGPU adapter is available in this browser session')
    const device = await adapter.requestDevice()
    device.lost.then(info => lost(`WebGPU device lost: ${info.message || info.reason}. Reload the editor.`))
    device.addEventListener('uncapturederror', event => lost(event.error.message))
    return { presenter: new Presenter(canvas, device), adapter: adapter.info.description || adapter.info.vendor || 'WebGPU' }
  }

  /** Present native-resolution pixels. Zoom and pan operate on the canvas in the UI. */
  show(pixels: Uint8Array<ArrayBuffer>, width: number, height: number) {
    if (width !== this.canvas.width || height !== this.canvas.height || !this.texture) {
      this.texture?.destroy(); this.canvas.width = width; this.canvas.height = height
      this.texture = this.device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    }
    this.device.queue.writeTexture({ texture: this.texture }, pixels, { bytesPerRow: width * 4 }, [width, height])
    const bindGroup = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.texture.createView() }, { binding: 1, resource: this.sampler }] })
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] })
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end()
    this.device.queue.submit([encoder.finish()])
  }
}
