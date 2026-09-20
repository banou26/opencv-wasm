import { readFile, writeFile } from 'node:fs/promises'
import { createOpenCV } from '../lib/index.js'

const reference = JSON.parse(await readFile('scripts/reference/python-5.0.0.json', 'utf8'))
const cv = await createOpenCV()
const exclusions = [
  [/^cv2\.(cuda(?:_|\.|$)|ocl(?:_|\.|$)|ogl(?:\.|$)|gapi\.core\.ocl(?:\.|$)|UMat_(?:context|queue)$)/, 'GPU backend'],
  [/^cv2\.(?:(?:data|load_config_py3|mat_wrapper|misc|typing|version)(?:\.|$)|bootstrap$|error$|gapi\.cv$|utils\.cv2$)/, 'Python runtime or wheel packaging'],
  [/^cv2\.(instr|ipp|parallel)(\.|$)/, 'Native backend diagnostics'],
  [/^cv2\.(EVENT_|QT_|WINDOW_|WND_PROP_)/, 'Desktop window constants'],
  [/^cv2\.(?:namedWindow|destroyWindow|destroyAllWindows|imshow|waitKey|waitKeyEx|pollKey|startWindowThread|moveWindow|resizeWindow|setWindow|setMouseCallback|selectROI|selectROIs|createTrackbar|getTrackbarPos|setTrackbar|createButton|addText|displayOverlay|displayStatusBar|getWindow|currentUIFramework|redirectError)/, 'Desktop event loop or callback adapter'],
]
const report = { reference: { package: reference.package, packageVersion: reference.packageVersion, opencvVersion: reference.version }, scope: 'Runtime names, kinds, constant values and class-member inventory. Matching names do not establish signature or behavioral parity. The reference wheel itself does not contain every contrib module.', counts: {}, present: [], adapted: [], missing: [], different: [], excluded: [], missingMembers: [], excludedMembers: [] }
const lookup = path => path.slice(4).split('.').reduce((value, key) => value?.[key], cv)
const adapted = new Map([
  ['cv2.GArray', 'Typed factory object in place of a Python dynamic class'],
  ['cv2.GOpaque', 'Typed factory object in place of a Python dynamic class'],
  ['cv2.gapi.GArray', 'Typed factory object in place of a Python dynamic class'],
  ['cv2.gapi.GOpaque', 'Typed factory object in place of a Python dynamic class'],
  ['cv2.gapi.op', 'Typed matrix, scalar, array and opaque operation definition in place of a Python class decorator'],
  ['cv2.gapi.kernel', 'Synchronous typed CPU callback in place of a Python class decorator'],
  ['cv2.gapi.kernels', 'Combines native kernel packages including TypeScript CPU callbacks'],
  ['cv2.gapi.descr_of', 'Matrix metadata values for typed graph callbacks'],
  ['cv2.gapi.wip.make_capture_src', 'Serial asynchronous source for virtual-filesystem videos'],
  ['cv2.gapi.wip.get_streaming_source', 'Accepts JavaScript frame iterables or source objects'],
  ['cv2.gapi.networks', 'Packages typed OpenCV DNN parameters for native graph inference; OpenVINO and ONNX Runtime parameters are unavailable'],
])
for (const [path, entry] of Object.entries(reference.entries)) {
  const excluded = exclusions.find(([pattern]) => pattern.test(path))?.[1]
  if (excluded) {
    report.excluded.push({ path, kind: entry.kind, reason: excluded })
    continue
  }
  const value = lookup(path)
  if (value !== undefined && adapted.has(path)) report.adapted.push({ path, kind: entry.kind, reason: adapted.get(path) })
  else if (value !== undefined && ((entry.kind !== 'function' && entry.kind !== 'class') || typeof value === 'function')) {
    if (entry.kind === 'constant' && value !== entry.value) {
      report.different.push({ path, kind: entry.kind, expected: entry.value, actual: value })
      continue
    }
    report.present.push({ path, kind: entry.kind })
    if (entry.kind === 'class' && value.prototype) {
      for (const [name, kind] of Object.entries(entry.members)) {
        if (kind !== 'method' || name in value.prototype || name in value) continue
        const reason = path === 'cv2.Mat' ? 'NumPy ndarray method; native Mat uses explicit OpenCV operations' : path === 'cv2.UMat' && ['context', 'handle', 'queue'].includes(name) ? 'GPU backend' : undefined
        ;(reason ? report.excludedMembers : report.missingMembers).push({ path: path + '.' + name, reason: reason || 'No same-named method on the bound class' })
      }
    }
  } else report.missing.push({ path, kind: entry.kind })
}
report.counts = { referenceSymbols: Object.keys(reference.entries).length, presentSymbols: report.present.length, adaptedSymbols: report.adapted.length, missingSymbols: report.missing.length, differentSymbols: report.different.length, excludedSymbols: report.excluded.length, missingClassMethods: report.missingMembers.length, excludedClassMethods: report.excludedMembers.length }
await writeFile('lib/python-parity.json', JSON.stringify(report, null, 2) + '\n')
console.log(report.counts)
const grouped = {}
for (const item of report.missing) {
  const group = item.path.split('.').length > 2 ? item.path.split('.').slice(1, -1).join('.') : 'root'
  grouped[group] = (grouped[group] || 0) + 1
}
console.log('Missing by namespace:', grouped)
