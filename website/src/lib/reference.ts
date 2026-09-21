import generated from '../data/api.generated.json'

/** One documented parameter, with the package's exact binding name. */
export type Parameter = { name: string; description: string }
/** An overload family collapsed into one reference entry without losing signatures. */
export type Member = { name: string; signatures: string[]; description: string; parameters: Parameter[]; returns: string; sources: string[]; static?: boolean }
/** A public native symbol or TypeScript helper extracted from the built declarations. */
export type APIEntry = Member & { slug: string; display: string; kind: string; module: string; members: Member[]; bases: string[]; importable: boolean }
/** The generated declaration inventory and measured Python compatibility report. */
export const reference = generated as unknown as { entries: APIEntry[]; constants: APIEntry[]; modules: string[]; coverage: { version: string; modules: string[]; unavailable: string[] }; parity: { reference: { packageVersion: string }; counts: Record<string, number>; missing: { path: string; reason?: string }[]; missingMembers: unknown[] }; documentation: { declarations: number; upstream: number; fallback: number } }
const lookup = new Map(reference.entries.map(e => [e.name, e]))
/** Resolve a native binding name to its generated reference page. */
export const apiURL = (name: string) => lookup.has(name) ? `/api/${lookup.get(name)!.slug}/` : undefined
/** Module names whose spelling differs from a Python namespace are kept explicit. */
export const moduleTitle = (name: string) => ({ typescript: 'TypeScript helpers', core: 'Core and matrices', imgproc: 'Image processing', calib: 'Calibration and geometry', features: 'Features and matching', dnn: 'Deep neural networks', photo: 'Computational photography', video: 'Motion and tracking', imgcodecs: 'Image codecs', ximgproc: 'Extended image processing' }[name] ?? name)
