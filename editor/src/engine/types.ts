/** Connection payload categories, shared by the editor and evaluator. */
export type PortType = 'frame' | 'video' | 'regions' | 'flow' | 'motion' | 'scalar' | 'boolean' | 'string' | 'vector' | 'rect' | 'frames' | 'custom'
/** Native operations, typed values and reusable graph interfaces. */
export type NodeType = 'source' | 'grayscale' | 'blur' | 'delta' | 'motion' | 'translateX' | 'translateY' | 'multiply' | 'constant' | 'group' | 'groupInput' | 'groupOutput' | 'output' | 'time' | 'offset' | 'extractFrame' | 'threshold' | 'composite'
  | 'clip' | 'readFrame' | 'videoInfo' | 'imageInfo' | 'text' | 'boolean' | 'vector' | 'rectangle' | 'splitVector' | 'splitRectangle' | 'math' | 'compare' | 'logic' | 'selectNumber'
  | 'coverage' | 'crop' | 'paste' | 'resize' | 'rotate' | 'flip' | 'boxBlur' | 'medianBlur' | 'bilateral' | 'sobel' | 'scharr' | 'laplacian' | 'canny' | 'normalize' | 'invert' | 'brightness' | 'adaptiveThreshold' | 'erode' | 'dilate' | 'morphology' | 'equalize' | 'clahe' | 'distanceTransform'
  | 'frameList' | 'pyrDown' | 'pyrUp' | 'gaussianPyramid' | 'laplacianPyramid' | 'pyramidLevel' | 'reconstructPyramid' | 'addImages' | 'subtractImages' | 'multiplyImages' | 'blendImages' | 'channel' | 'mergeChannels' | 'magnitude' | 'phaseCorrelation' | 'makeRecord' | 'breakRecord'
  | 'farneback' | 'offsetFlow' | 'flowConsistency' | 'cornerStrength' | 'flowGrid' | 'drawFlow' | 'coordinates' | 'noise' | 'pixelMath'
  | 'sceneRange' | 'regionalMotion' | 'regionalPool' | 'regionalTracks' | 'regionalHistory' | 'regionalTiming' | 'regionalInspect'
/** Serializable parameters; finite numbers only. */
export type Params = Record<string, string | number | boolean>
/** A typed socket; frameParam pins upstream time, while offsetParam shifts it. */
export type Port = { id: string; label: string; type: PortType; schema?: string; parameter?: string; offsetParam?: string; frameParam?: string; optional?: boolean; default?: string | number | boolean }
/** Declarative parameter controls and their validation constraints. */
export type Parameter =
  | { kind: 'number'; key: string; label: string; default: number; min: number; max: number; step: number }
  | { kind: 'boolean'; key: string; label: string; default: boolean }
  | { kind: 'select'; key: string; label: string; default: string; options: string[] }
  | { kind: 'text'; key: string; label: string; default: string; maxLength: number }
/** A node's public contract. Increment version when output semantics change. */
export type NodeSpec = { type: NodeType; title: string; category: string; description: string; algorithm: string; version: number; inputs: Port[]; outputs: Port[]; parameters: Parameter[] }
/** A saved node, independent of React Flow's view state. */
export type GraphNode = { id: string; type: NodeType; params: Params; definition?: string; dataType?: string; asset?: string; assetName?: string; position: { x: number; y: number } }
/** One edge into one input socket. Every input accepts at most one edge. */
export type GraphEdge = { id: string; source: string; sourceHandle: string; target: string; targetHandle: string }
/** Portable graph data; media files are attached separately by the user. */
export type GraphBody = { version: 1; nodes: GraphNode[]; edges: GraphEdge[] }
/** A reusable typed function whose implementation consists entirely of normal graph nodes. */
export type NodeDefinition = { id: string; name: string; description?: string; inputs: Port[]; outputs: Port[]; graph: GraphBody }
/** Named records hold typed fields, like a Blueprint struct or a node-group data bundle. */
export type DataTypeDefinition = { id: string; name: string; fields: Port[] }
export type GraphDocument = GraphBody & { definitions?: NodeDefinition[]; dataTypes?: DataTypeDefinition[]; interfaceId?: string }
/** Editor connection candidates also include incomplete drags. */
export type Connection = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }
/** A cache-owned result bundle; bytes is its standalone estimate, including shared storage. */
export type Bundle<T> = {
  outputs: Record<string, T>; bytes: number; dispose: () => void
  /** Immutable JS allocations, counted by identity across bundles; never native handles. */
  shared?: ReadonlyMap<object, number>
}
/** A pinned result. The caller must release it when it stops using the values. */
export type Lease<T> = { value: T; release: () => void }
