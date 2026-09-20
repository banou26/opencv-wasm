"""Generate native bindings from the same annotated C++ declarations as Python."""
import json
import re
from pathlib import Path

PRIMITIVES = set('void bool char uchar short ushort int uint long float double size_t int32_t int64 uint64 int64_t uint64_t'.split()) | {'long long', 'signed char', 'unsigned char', 'unsigned short', 'unsigned', 'unsigned int', 'unsigned long', 'std::string'}
BUILTINS = set('Mat MatShape Range TermCriteria Size Size2f Point Point2f Point3f Rect Rect2f Rect2d RotatedRect KeyPoint DMatch Scalar Moments Exception Tracker GComputation'.split())
VECTORS = dict(zip(['int', 'char', 'float', 'double', 'std::string', 'cv::Point', 'cv::Point2f', 'cv::Point3f', 'cv::Mat', 'cv::Rect', 'cv::KeyPoint', 'cv::DMatch', 'std::vector<char>', 'std::vector<cv::DMatch>', 'std::vector<cv::KeyPoint>', 'std::vector<cv::Point>'], ['IntVector', 'CharVector', 'FloatVector', 'DoubleVector', 'StringVector', 'PointVector', 'Point2fVector', 'Point3fVector', 'MatVector', 'RectVector', 'KeyPointVector', 'DMatchVector', 'CharVectorVector', 'DMatchVectorVector', 'KeyPointVectorVector', 'PointVectorVector']))


def prepare(generator, config, dst_file, src_files, core_bindings):
    classes = {name: cls for name, cls in generator.classes.items() if not cls.cname.startswith('cv::cuda::')}
    enums = {n.replace('.', '::') for ns in generator.namespaces.values() for n in ns.enums if '.unnamed_' not in n}
    known = {c.cname for c in classes.values()} | {'cv::' + n for n in BUILTINS} | enums
    aliases = {c.name: c.cname for c in classes.values()}
    aliases.update({n.removeprefix('cv::').replace('::', '_'): n for n in enums})
    custom_types = {'cv::UMat', 'cv::flann::IndexParams', 'cv::flann::SearchParams', 'cv::dnn::LayerParams', 'std::pair<int, double>', 'cv::gapi::wip::draw::Prim'}
    known.update(custom_types)
    enums.update({'cvflann::flann_distance_t', 'cvflann::flann_algorithm_t'})
    aliases.update({'cvflann_flann_distance_t': 'cvflann::flann_distance_t', 'cvflann_flann_algorithm_t': 'cvflann::flann_algorithm_t'})
    vectors, extras, skipped, exposed, wrappers, bindings = dict(VECTORS), {}, [], [], [], []
    graph_types, tuples, maps = {}, {}, {}
    manual = '#define CERES_FOUND 1\n' + Path(core_bindings).read_text()
    manual = manual.replace('.property("rows", &cv::Mat::rows)', '.property("dims", +[](const cv::Mat& mat) { return mat.dims; })\n        .property("rows", &cv::Mat::rows)')
    # OpenCV 5 adds unsigned 32-bit and signed/unsigned 64-bit pixel types.
    # Keep their views exact rather than converting large integer pixels to doubles.
    manual = manual.replace('.property("data64F", &binding_utils::matData<double>)', '''.property("data64F", &binding_utils::matData<double>)
        .property("data32U", &binding_utils::matData<uint32_t>)
        .property("data64S", &binding_utils::matData<int64_t>)
        .property("data64U", &binding_utils::matData<uint64_t>)''')
    manual += '\n' + Path('/work/scripts/extra-bindings.cpp').read_text()
    manual += '\n' + Path('/work/scripts/callback-bridge.hpp').read_text()
    manual += '\n' + Path('/work/scripts/graph-bindings.cpp').read_text()
    manual += '\n' + Path('/work/scripts/graph-kernels.cpp').read_text()
    manual += '\n' + Path('/work/scripts/graph-typed-kernels.cpp').read_text()
    manual += '\n' + Path('/work/scripts/graph-inference.cpp').read_text()
    manual += '\n' + Path('/work/scripts/dnn-bindings.cpp').read_text()
    manual = manual.replace('emscripten::class_<cv::Tracker >("Tracker")', 'emscripten::class_<cv::Tracker >("Tracker").smart_ptr<cv::Ptr<cv::Tracker>>("Ptr_Tracker")')
    manual = manual.replace('.function("init", select_overload<void(cv::Tracker&', '.function("getTrackingScore", &cv::Tracker::getTrackingScore)\n        .function("init", select_overload<void(cv::Tracker&')
    manual_functions = set(re.findall(r'(?<!\.)\bfunction\("([^"\n]+)"', manual))

    def resolve(tp, context):
        tp = re.sub(r'\bconst\b', '', tp).replace('&', '').strip()
        if tp.startswith('vector_'):
            tp = 'std::vector<' + tp[7:] + '>'
        if tp.startswith('Ptr::'):
            tp = 'cv::Ptr<' + tp[5:] + '>'
        tp = {'Point2i': 'Point', 'Size2i': 'Size', 'MatShape': 'cv::MatShape', 'FeatureDetector': 'Feature2D',
              'ANN::MLP': 'ANN_MLP', 'c_string': 'std::string',
              'NativeByteArray': 'std::vector<uchar>', 'Pose3DPtr': 'cv::Ptr<cv::ppf_match_3d::Pose3D>',
              'size::t': 'size_t', 'GMat2': 'tuple_GMat_and_GMat',
              'pair::int::and::double': 'std::pair<int, double>', 'LayerId': 'cv::dnn::DictValue'}.get(tp, tp)
        tp = {'String': 'std::string', 'string': 'std::string', 'InputArray': 'cv::Mat', 'OutputArray': 'cv::Mat', 'InputOutputArray': 'cv::Mat', 'InputArrayOfArrays': 'std::vector<cv::Mat>', 'OutputArrayOfArrays': 'std::vector<cv::Mat>', 'InputOutputArrayOfArrays': 'std::vector<cv::Mat>'}.get(tp, tp)
        if tp in PRIMITIVES:
            return tp
        if tp.startswith('tuple_'):
            members = [resolve(part, context) for part in tp[6:].replace('_end_', '').split('_and_')]
            cpp = 'std::tuple<' + ', '.join(members) + '>'
            tuples[cpp] = (tp, members)
            return cpp
        if tp.startswith(('GArray_', 'GOpaque_')):
            template, inner = tp.split('_', 1)
            cpp = 'cv::' + template + '<' + resolve(inner, context) + '>'
            graph_types[cpp] = tp
            return cpp
        if tp.startswith('map_'):
            key, value = tp[4:].split('_and_', 1)
            key, value = resolve(key, context), resolve(value, context)
            cpp = 'std::map<' + key + ', ' + value + '>'
            maps[cpp] = (tp, key, value)
            if key not in vectors:
                vectors[key] = re.sub(r'\W', '_', key) + 'Vector'
            return cpp
        if '*' in tp or '[' in tp or not tp:
            raise ValueError('pointer, array or unspecified type: ' + tp)
        match = re.fullmatch(r'(?:std::)?vector<(.+)>', tp)
        if match:
            inner = resolve(match[1], context)
            if inner not in vectors:
                vectors[inner] = re.sub(r'[^a-zA-Z0-9]', '_', inner.removeprefix('cv::')).strip('_') + 'Vector'
            return 'std::vector<' + inner + '>'
        match = re.fullmatch(r'(?:cv::)?Ptr<(.+)>', tp)
        if match:
            inner = resolve(match[1], context)
            if inner not in {c.cname for c in classes.values()} | custom_types:
                raise ValueError('smart pointer to unbound type: ' + inner)
            return 'cv::Ptr<' + inner + '>'
        if tp in aliases:
            return aliases[tp]
        scopes = context.replace('.', '::').split('::')
        for length in range(len(scopes), 0, -1):
            candidate = '::'.join(scopes[:length] + [tp])
            if candidate in known:
                return candidate
        if tp in known:
            return tp
        tail = tp.split('::')[-1]
        if 'cv::' + tail in known:
            return 'cv::' + tail
        for alias, cpp in aliases.items():
            if alias.endswith('_' + tp) and cpp.startswith(context.replace('.', '::').split('::')[0] + '::'):
                return cpp
        for candidate in [tp, 'cv::' + tp]:
            match = re.fullmatch(r'cv::(Point[23]?[dif]|Size2[dif]|Vec[23468][bwsifd]|Matx\d\d[fd])', candidate)
            if match:
                extras[candidate] = match[1]
                known.add(candidate)
                return candidate
        raise ValueError('no value conversion for ' + tp)

    def generate(func, owner=None):
        parts = []
        scope = owner.cname if owner else func.namespace
        prefix = func.namespace.removeprefix('cv').strip('.').replace('.', '_')
        public_base = func.name if owner else (prefix + '_' if prefix else '') + func.name
        if func.namespace.startswith('cv.cuda'):
            skipped.append({'name': public_base, 'reason': 'CUDA runtime is unavailable in browsers'})
            return []
        if not owner and public_base in manual_functions:
            return []
        if owner and owner.name == 'IStreamReader' and func.name == 'read':
            vectors['uchar'] = 'ucharVector'
            cpp_name = 'binding_' + str(len(wrappers))
            wrappers.append(f'std::vector<uchar> {cpp_name}(cv::IStreamReader& self, int size) {{ '
                            'CV_Assert(size >= 0); std::vector<uchar> data(size); auto count = self.read(reinterpret_cast<char*>(data.data()), size); '
                            'CV_Assert(count >= 0 && count <= size); data.resize(count); return data; }')
            return [f'.function("read", &Generated::{cpp_name})']
        if owner and owner.name == 'ml_TrainData' and func.name in {'getSample', 'getValues'}:
            sample = func.name == 'getSample'
            signature = 'cv::Mat& indices, int index' if sample else 'int index, cv::Mat& indices'
            call = 'self.getSample(indices, index, result.data())' if sample else 'self.getValues(index, indices, result.data())'
            size = 'self.getNAllVars()' if sample else 'self.getNSamples()'
            cpp_name = 'binding_' + str(len(wrappers))
            wrappers.append(f'std::vector<float> {cpp_name}({owner.cname}& self, {signature}) {{ '
                            + f'std::vector<float> result(indices.empty() ? {size} : indices.total()); '
                            + call + '; return result; }')
            exposed.append({'name': owner.name + '.' + func.name, 'cpp': func.cname, 'return': 'std::vector<float>', 'arguments': ['cv::Mat', 'int'] if sample else ['int', 'cv::Mat'], 'parameters': ['indices', 'index'] if sample else ['index', 'indices']})
            return [f'.function("{func.name}", &Generated::{cpp_name})']
        static_index = 0
        for index, variant in enumerate(func.variants):
            public = public_base + (str(index) if index else '')
            label = (owner.name + '.' if owner else '') + public
            try:
                if owner and owner.name == 'freetype_FreeType2' and func.name == 'loadFontData' and len(variant.args) == 3:
                    vectors['uchar'] = 'ucharVector'
                    cpp_name = 'binding_' + str(len(wrappers))
                    wrappers.append(f'void {cpp_name}({owner.cname}& self, std::vector<uchar>& bytes, int index) {{ self.loadFontData(reinterpret_cast<char*>(bytes.data()), bytes.size(), index); }}')
                    parts.append(f'.function("{public}", &Generated::{cpp_name})')
                    exposed.append({'name': label, 'cpp': func.cname, 'return': 'void', 'arguments': ['std::vector<uchar>', 'int'], 'parameters': ['bytes', 'index']})
                    continue
                hdf = owner and owner.name == 'hdf_HDF5'
                if hdf and func.name == 'atread' and '*' in variant.args[0].tp:
                    variant.args[0].outputarg = True
                    variant.args[0].inputarg = False
                pointer_vectors = {i for i, a in enumerate(variant.args) if hdf and 'int*' in a.tp and not a.outputarg}
                ret = resolve(variant.rettype or 'void', scope)
                args = [resolve('std::vector<int>' if i in pointer_vectors else a.tp.replace('*', '') if a.outputarg else a.tp, scope) for i, a in enumerate(variant.args)]
                if owner and owner.name in {'sfm_BaseSFM', 'sfm_SFMLibmvEuclideanReconstruction'}:
                    args = ['std::vector<cv::Mat>' if tp == 'cv::Mat' and a.name in {'points3d', 'Rs', 'Ts'} else tp for a, tp in zip(variant.args, args)]
                outputs = {i: t for i, (a, t) in enumerate(zip(variant.args, args))
                           if (t in PRIMITIVES and (a.outputarg or ('&' in a.tp and not a.const)))
                           or (a.outputarg and ('*' in a.tp or t in extras or t.removeprefix('cv::') in BUILTINS - {'Mat', 'Tracker'}))}
                if outputs:
                    result_type = re.sub(r'\W', '_', label) + 'Result'
                    members = [('value', ret)] if ret != 'void' else []
                    members += [(variant.args[i].name, t) for i, t in outputs.items()]
                    wrappers.append('struct ' + result_type + ' { ' + ''.join(t + ' ' + n + '{}; ' for n, t in members) + '};')
                    bindings.append('emscripten::value_object<Generated::' + result_type + '>("' + result_type + '")'
                                    + ''.join(f'.field("{n}", &Generated::{result_type}::{n})' for n, _ in members) + ';')
                    inputs = [i for i in range(len(args)) if i not in outputs]
                    required = len(inputs)
                    while required and variant.args[inputs[required - 1]].defval:
                        required -= 1
                    for count in range(required, len(inputs) + 1):
                        signature = [owner.cname + '& self'] if owner and not variant.is_class_method else []
                        expressions = []
                        for i, (arg, tp) in enumerate(zip(variant.args, args)):
                            if i in outputs:
                                expressions.append(('&' if '*' in arg.tp else '') + 'result.' + arg.name)
                            elif i in inputs[:count]:
                                signature.append(('int' if tp in enums else tp) + ('&' if tp not in PRIMITIVES and tp not in enums else '') + ' a' + str(i))
                                expressions.append(('static_cast<' + tp + '>(a' + str(i) + ')') if tp in enums else 'a' + str(i))
                            else:
                                expressions.append(arg.defval)
                        target = (owner.cname + '::' if variant.is_class_method else 'self.') + func.cname if owner else func.cname
                        cpp_name = 'binding_' + str(len(wrappers))
                        call = target + '(' + ', '.join(expressions) + ')'
                        wrappers.append(result_type + ' ' + cpp_name + '(' + ', '.join(signature) + ') { '
                                        + result_type + ' result{}; ' + ('result.value = ' if ret != 'void' else '')
                                        + call + '; return result; }')
                        bind = f'("{public}", &Generated::{cpp_name})'
                        if owner:
                            parts.append(('.class_function' if variant.is_class_method else '.function') + bind)
                        else:
                            bindings.append('emscripten::function' + bind + ';')
                    exposed.append({'name': label, 'cpp': func.cname, 'return': result_type, 'arguments': [args[i] for i in inputs], 'parameters': [variant.args[i].name for i in inputs]})
                    continue
                defaults = 0
                for a in reversed(variant.args):
                    if not a.defval:
                        break
                    defaults += 1
                for count in range(len(args) - defaults, len(args) + 1):
                    signature, expressions, before, after = [], [], [], []
                    if owner and not variant.is_class_method:
                        signature.append(owner.cname + '& self')
                    for i, (arg, tp) in enumerate(zip(variant.args[:count], args[:count])):
                        exposed_type = 'int' if tp in enums else tp
                        if tp not in PRIMITIVES and tp not in enums and not tp.startswith('cv::Ptr<'):
                            exposed_type += '&'
                        signature.append(exposed_type + ' a' + str(i))
                        expression = ('static_cast<' + tp + '>(a' + str(i) + ')') if tp in enums else 'a' + str(i)
                        if 'c_string' in arg.tp:
                            expression += '.c_str()'
                        if i in pointer_vectors:
                            ndims = next((j for j, a in enumerate(variant.args) if a.name == 'n_dims'), None)
                            label_index = next((j for j, a in enumerate(variant.args) if a.name == 'dslabel'), None)
                            expected = 'a' + str(ndims) if ndims is not None else '2' if func.name == 'dscreate' else f'self.dsgetsize(a{label_index}).size()'
                            allow_empty = bool(arg.defval) or arg.name != 'sizes'
                            before.append(f'CV_Assert({"a" + str(i) + ".empty() || " if allow_empty else ""}a{i}.size() == static_cast<size_t>({expected}));')
                            expression = f'(a{i}.empty() ? nullptr : a{i}.data())'
                        if 'NativeByteArray' in arg.tp:
                            before.append(f'std::vector<std::string> bytes_{i};')
                            expression = f'bytes_{i}'
                            after.append(f'a{i}.clear(); for (const auto& bytes : bytes_{i}) a{i}.emplace_back(bytes.begin(), bytes.end());')
                        expressions.append(expression)
                    target = (owner.cname + '::' if variant.is_class_method else 'self.') + func.cname if owner else func.cname
                    result = 'int' if ret in enums else ret
                    cpp_name = 'binding_' + str(len(wrappers))
                    call = target + '(' + ', '.join(expressions) + ')'
                    if ret in enums:
                        call = 'static_cast<int>(' + call + ')'
                    if before or variant.rettype == 'NativeByteArray':
                        returned = 'std::vector<uchar>(value.begin(), value.end())' if variant.rettype == 'NativeByteArray' else 'value'
                        body = ' '.join(before) + (' ' if ret == 'void' else ' auto value = ') + call + '; ' + ' '.join(after) + ('' if ret == 'void' else ' return ' + returned + ';')
                    else:
                        body = 'return ' + call + ';'
                    wrappers.append(result + ' ' + cpp_name + '(' + ', '.join(signature) + ') { ' + body + ' }')
                    bind = f'("{public}", &Generated::{cpp_name})'
                    if owner:
                        parts.append(('.class_function' if variant.is_class_method else '.function') + bind)
                        if variant.is_class_method:
                            static_name = func.name + (str(static_index) if static_index else '')
                            bindings.append(f'emscripten::function("{owner.name}_{static_name}", &Generated::{cpp_name});')
                    else:
                        bindings.append('emscripten::function' + bind + ';')
                exposed.append({'name': label, 'cpp': func.cname, 'return': ret, 'arguments': args, 'parameters': [a.name for a in variant.args]})
                if variant.is_class_method:
                    static_index += 1
            except ValueError as error:
                skipped.append({'name': label, 'cpp': func.cname, 'reason': str(error)})
        return parts

    for ns in generator.namespaces.values():
        for func in ns.funcs.values():
            generate(func)
    for name, cls in classes.items():
        if name in BUILTINS:
            continue
        bases = []
        for base in cls.bases[:1]:
            if base == 'detail::GraphCutSeamFinderBase':
                base = 'cv::detail::SeamFinder'
            try:
                bases.append(resolve(base, cls.cname))
            except ValueError:
                skipped.append({'name': name, 'reason': 'unbound base ' + base})
        pieces, constructor_counts = [], set()
        if name == 'sfm_SFMLibmvEuclideanReconstruction':
            for count in range(3):
                arguments = ['const cv::sfm::libmv_CameraIntrinsicsOptions& camera', 'const cv::sfm::libmv_ReconstructionOptions& options'][:count]
                values = ['camera', 'options'][:count]
                wrapper = f'+[]({", ".join(arguments)}) {{ return {cls.cname}::create({", ".join(values)}); }}'
                pieces.append(f'.class_function("create", {wrapper})')
                bindings.append(f'emscripten::function("sfm_SFMLibmvEuclideanReconstruction_create", {wrapper});')
        for func in cls.methods.values():
            if func.is_constructor:
                for variant_index, variant in enumerate(func.variants):
                    try:
                        types = [resolve(a.tp, cls.cname) for a in variant.args]
                        required = len(types)
                        while required and variant.args[required - 1].defval:
                            required -= 1
                        for count in range(required, len(types) + 1):
                            if count not in constructor_counts:
                                signatures = [t + ('&' if t not in PRIMITIVES and t not in enums and not t.startswith('cv::Ptr<') else '') for t in types[:count]]
                                pieces.append('.constructor<' + ','.join(signatures) + '>()')
                                constructor_counts.add(count)
                            else:
                                cpp_name = 'binding_' + str(len(wrappers))
                                signatures = [t + ('&' if t not in PRIMITIVES and t not in enums and not t.startswith('cv::Ptr<') else '') + ' a' + str(i) for i, t in enumerate(types[:count])]
                                wrappers.append('cv::Ptr<' + cls.cname + '> ' + cpp_name + '(' + ', '.join(signatures) + ') { return cv::makePtr<' + cls.cname + '>(' + ', '.join('a' + str(i) for i in range(count)) + '); }')
                                pieces.append(f'.class_function("from{variant_index}", &Generated::{cpp_name})')
                    except ValueError as error:
                        skipped.append({'name': name + '.constructor', 'reason': str(error)})
            else:
                pieces.extend(generate(func, cls))
        if getattr(cls, 'isparams', False) and 0 not in constructor_counts:
            pieces.append('.constructor<>()')
        if name == 'Filter2DParams' and not any(prop.name == 'borderValue' for prop in cls.props):
            pieces.append('.property("borderValue", &cv::Filter2DParams::borderValue)')
        for prop in cls.props:
            try:
                tp = resolve(prop.tp, cls.cname)
                if tp in enums:
                    getter = f'+[](const {cls.cname}& v) {{ return static_cast<int>(v.{prop.name}); }}'
                    setter = f', +[]({cls.cname}& v, int x) {{ v.{prop.name} = static_cast<{tp}>(x); }}' if not prop.readonly else ''
                    pieces.append(f'.property("{prop.name}", {getter}{setter})')
                else:
                    pieces.append(f'.property("{prop.name}", &{cls.cname}::{prop.name})')
            except ValueError as error:
                skipped.append({'name': name + '.' + prop.name, 'reason': str(error)})
        inheritance = ''.join(', GeneratedBase<' + base + '>' for base in bases)
        bindings.append(f'emscripten::class_<{cls.cname}{inheritance}>("{name}").smart_ptr<cv::Ptr<{cls.cname}>>("Ptr_{name}")' + ''.join(pieces) + ';')
    constants = set()
    for ns_name, ns in generator.namespaces.items():
        for enum_name, values in ns.enums.items():
            if '.unnamed_' in enum_name:
                continue
            cpp_type = enum_name.replace('.', '::')
            js_type = enum_name.removeprefix('cv.').replace('.', '_')
            fields = ''.join(f'.value("{v[0].split(".")[-1]}", {cpp_type}::{v[0].split(".")[-1]})' for v in values)
            bindings.append(f'emscripten::enum_<{cpp_type}>("{js_type}"){fields};')
        prefix = ns_name.removeprefix('cv').strip('.').replace('.', '_')
        for name, cpp in ns.consts.items():
            public = (prefix + '_' if prefix else '') + name
            if public not in constants:
                constants.add(public)
                bindings.append(f'emscripten::constant("{public}", static_cast<double>({cpp}));')
            compat = (prefix + '_' if prefix else '') + re.sub(r'([a-z])([A-Z])', r'\1_\2', name).upper()
            if compat not in constants:
                constants.add(compat)
                bindings.append(f'emscripten::constant("{compat}", static_cast<double>({cpp}));')
    graph_values = {'int': 'CV_INT', 'int64_t': 'CV_INT64', 'double': 'CV_DOUBLE', 'float': 'CV_FLOAT', 'uint64_t': 'CV_UINT64', 'bool': 'CV_BOOL', 'std::string': 'CV_STRING', 'cv::Point': 'CV_POINT', 'cv::Point2f': 'CV_POINT2F', 'cv::Point3f': 'CV_POINT3F', 'cv::Size': 'CV_SIZE', 'cv::Rect': 'CV_RECT', 'cv::Mat': 'CV_MAT', 'cv::Scalar': 'CV_SCALAR'}
    graph_values['cv::gapi::wip::draw::Prim'] = 'CV_DRAW_PRIM'
    for cpp in graph_values:
        for template in ['GArray', 'GOpaque']:
            if template == 'GOpaque' and cpp in {'cv::Mat', 'cv::Scalar', 'cv::gapi::wip::draw::Prim'}:
                continue
            graph_types.setdefault('cv::' + template + '<' + cpp + '>', template + '_' + cpp.removeprefix('cv::').replace('std::', '').replace('::', '_'))
    # Python ArgType differs numerically from the internal OpaqueKind enum.
    python_bridge = Path('/work/vendor/opencv_contrib-5.0.0/modules/gapi/misc/python/python_bridge.hpp').read_text()
    arg_types = re.search(r'enum ArgType \{([^}]+)\}', python_bridge).group(1)
    for value, kind in enumerate(re.findall(r'\bCV_\w+\b', arg_types)):
        constants.add('gapi_' + kind)
        bindings.append(f'emscripten::constant("gapi_{kind}", {value});')
    manual = manual.replace('@GRAPH_PROTOTYPES@', '\n'.join(f'else if (value.instanceof(emscripten::val::module_property("{name}"))) args.emplace_back(cv::detail::wrap_gapi_helper<{cpp}>::wrap(value.as<{cpp}>()));' for cpp, name in graph_types.items()))
    manual = manual.replace('@DRAW_PRIMITIVES@', '\n'.join(('if' if i == 0 else 'else if') + f' (value.instanceof(emscripten::val::module_property("gapi_wip_draw_{name}"))) result.emplace_back(value.as<cv::gapi::wip::draw::{name}>());' for i, name in enumerate(['Text', 'Rect', 'Circle', 'Line', 'Mosaic', 'Image', 'Poly'])))
    manual = manual.replace('@GRAPH_INPUTS@', '\n'.join(f'case cv::detail::OpaqueKind::{kind}: args.emplace_back(unpack<{cpp}>(value, array)); break;' for cpp, kind in graph_values.items()))
    manual = manual.replace('@GRAPH_OUTPUTS@', '\n'.join(f'case cv::detail::OpaqueKind::{kind}: result.set(i, pack<{cpp}>(arg, array)); break;' for cpp, kind in graph_values.items()))
    port_names = {'int': 'int', 'int64_t': 'int64', 'uint64_t': 'uint64', 'double': 'double', 'float': 'float', 'bool': 'bool', 'std::string': 'string', 'cv::Point': 'point', 'cv::Point2f': 'point2f', 'cv::Point3f': 'point3f', 'cv::Size': 'size', 'cv::Rect': 'rect', 'cv::Mat': 'mat', 'cv::Scalar': 'scalar', 'cv::gapi::wip::draw::Prim': 'prim'}
    graph_ports = {}
    for cpp, name in graph_types.items():
        template, inner = re.fullmatch(r'cv::(GArray|GOpaque)<(.+)>', cpp).groups()
        if inner in port_names:
            token = ('array:' if template == 'GArray' else 'opaque:') + port_names[inner]
            graph_ports[token] = {'node': name, 'cpp': cpp}
    manual = manual.replace('@TYPED_GRAPH_PORTS@', '\n'.join(f'if (name == "{token}") return port<{port["cpp"]}>("{port["node"]}");' for token, port in graph_ports.items()))
    extra_bindings = []
    for cpp, name in graph_types.items():
        extra_bindings.append(f'emscripten::class_<{cpp}>("{name}").constructor<>();')
    for cpp, (name, members) in tuples.items():
        fields = ''.join(f'.element(+[](const {cpp}& v) {{ return std::get<{i}>(v); }}, +[]({cpp}& v, const {tp}& x) {{ std::get<{i}>(v) = x; }})' for i, tp in enumerate(members))
        extra_bindings.append(f'emscripten::value_array<{cpp}>("{name}"){fields};')
    for cpp, (name, key, value) in maps.items():
        extra_bindings.append(f'emscripten::register_map<{key}, {value}>("{name}");')
    for cpp, name in extras.items():
        if name.startswith('Point'):
            members = ['x', 'y'] + (['z'] if name.startswith('Point3') else [])
        elif name.startswith('Size'):
            members = ['width', 'height']
        else:
            dims = re.findall(r'\d', name)
            size = int(dims[0]) if name.startswith('Vec') else int(dims[0]) * int(dims[1])
            fields = ''.join(f'.element(+[](const {cpp}& v) {{ return static_cast<double>(v.val[{i}]); }}, +[]({cpp}& v, double x) {{ v.val[{i}] = x; }})' for i in range(size))
            extra_bindings.append(f'emscripten::value_array<{cpp}>("{name}"){fields};')
            continue
        fields = ''.join(f'.field("{field}", &{cpp}::{field})' for field in members)
        extra_bindings.append(f'emscripten::value_object<{cpp}>("{name}"){fields};')
    for cpp, name in vectors.items():
        if cpp not in VECTORS:
            extra_bindings.append(f'emscripten::register_vector<{cpp}>("{name}");')
    includes = '\n'.join('#include "' + p[p.rindex('opencv2/'):] + '"' for p in src_files if '.private.' not in p)
    manual = manual.replace('EMSCRIPTEN_CV_POINT(Point3f)', 'emscripten::value_object<cv::Point3f>("Point3f").field("x", &cv::Point3f::x).field("y", &cv::Point3f::y).field("z", &cv::Point3f::z);')
    manual += '''
template<class Base> struct GeneratedBase : emscripten::base<Base> {
  template<class Derived> static auto getDowncaster() {
    return +[](Base* value) -> Derived* {
      if constexpr (std::is_polymorphic_v<Base>) return dynamic_cast<Derived*>(value);
      else return static_cast<Derived*>(value);
    };
  }
};
'''
    output = manual.replace('@INCLUDES@', includes) + '\nnamespace Generated {\n' + '\n'.join(wrappers) + '\n}\n'
    output += '\nEMSCRIPTEN_BINDINGS(generated) {\n' + '\n'.join(extra_bindings + bindings) + '\n}\n'
    Path(dst_file).write_text(output)
    cache = Path('/work/build/wasm5/CMakeCache.txt').read_text()
    modules = re.search(r'^OPENCV_MODULES_BUILD:INTERNAL=(.*)$', cache, re.M).group(1).split(';')
    Path('/work/build/coverage.json').write_text(json.dumps({
        'opencvVersion': '5.0.0', 'emscriptenVersion': '4.0.3',
        'scope': 'Python-annotated declarations in the configured portable C++ modules, plus handwritten adapters. This is not a claim of complete cv2 parity.',
        'modules': [m.removeprefix('opencv_') for m in modules if m not in {'opencv_js', 'opencv_js_bindings_generator', 'opencv_highgui'}],
        'dependencyOnlyModules': ['highgui'],
        'graphPorts': graph_ports,
        'namespaces': sorted({n.removeprefix('cv.') for n in generator.parser.namespaces if n != 'cv' and not n.startswith('cv.cuda')} | {'gapi.dnn'}),
        'classBases': {cls.name: aliases.get(cls.bases[0], cls.bases[0]).removeprefix('cv::').replace('::', '_') for cls in classes.values() if cls.bases},
        'nestedClasses': {cls.name: cls.cname.removeprefix('cv::').replace('::', '.') for cls in classes.values() if cls.cname.rsplit('::', 1)[0].replace('::', '.') not in generator.parser.namespaces},
        'unavailableFeatures': ['CUDA', 'OpenCL acceleration', 'WebGPU', 'native GUI windows', 'native camera devices', 'FFmpeg and GStreamer video backends', 'G-API parallel streaming and desync regions', 'OpenVINO and ONNX Runtime graph backends', 'ovis', 'viz', 'cvv', 'AVIF codec', 'Python and NumPy runtime behavior'],
        'classes': sorted(classes), 'functions': exposed, 'excluded': skipped,
        'manualFunctions': sorted(manual_functions), 'constants': sorted(constants),
    }, indent=2) + '\n')
    print(f'Generated {len(exposed)} function variants, {len(classes)} classes, {len(constants)} constants; {len(skipped)} adapters outstanding')
    raise SystemExit(0)
