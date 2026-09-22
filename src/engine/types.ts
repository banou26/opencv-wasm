/** Connection payload categories, shared by the editor and evaluator. */
export type PortType = 'frame' | 'regions' | 'motion' | 'scalar'
/** The processing nodes supported by the first editor milestone. */
export type NodeType = 'source' | 'grayscale' | 'blur' | 'delta' | 'motion' | 'translateX' | 'translateY' | 'multiply' | 'constant' | 'group' | 'groupInput' | 'groupOutput' | 'output' | 'time' | 'offset' | 'threshold' | 'composite'
/** Serializable parameters; finite numbers only. */
export type Params = Record<string, string | number | boolean>
/** A typed socket; offsetParam requests a different upstream frame. */
export type Port = { id: string; label: string; type: PortType; offsetParam?: string; optional?: boolean; default?: number }
/** Declarative parameter controls and their validation constraints. */
export type Parameter =
  | { kind: 'number'; key: string; label: string; default: number; min: number; max: number; step: number }
  | { kind: 'boolean'; key: string; label: string; default: boolean }
  | { kind: 'select'; key: string; label: string; default: string; options: string[] }
/** A node's public contract. Increment version when output semantics change. */
export type NodeSpec = { type: NodeType; title: string; category: string; description: string; algorithm: string; version: number; inputs: Port[]; outputs: Port[]; parameters: Parameter[] }
/** A saved node, independent of React Flow's view state. */
export type GraphNode = { id: string; type: NodeType; params: Params; definition?: string; asset?: string; assetName?: string; position: { x: number; y: number } }
/** One edge into one input socket. Every input accepts at most one edge. */
export type GraphEdge = { id: string; source: string; sourceHandle: string; target: string; targetHandle: string }
/** Portable graph data; media files are attached separately by the user. */
export type GraphBody = { version: 1; nodes: GraphNode[]; edges: GraphEdge[] }
/** A reusable typed function whose implementation consists entirely of normal graph nodes. */
export type NodeDefinition = { id: string; name: string; inputs: Port[]; outputs: Port[]; graph: GraphBody }
export type GraphDocument = GraphBody & { definitions?: NodeDefinition[]; interfaceId?: string }
/** Editor connection candidates also include incomplete drags. */
export type Connection = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }
/** A cache-owned result bundle; dispose runs exactly once after its final lease. */
export type Bundle<T> = { outputs: Record<string, T>; bytes: number; dispose: () => void }
/** A pinned result. The caller must release it when it stops using the values. */
export type Lease<T> = { value: T; release: () => void }
