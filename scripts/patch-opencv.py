"""Apply reproducible changes to the pinned upstream binding generator."""
from pathlib import Path

def update(path, text):
    if path.read_text() != text:
        path.write_text(text)


root = Path('vendor/opencv-5.0.0')
# WASM's four float lanes must not be read back through a double array.
path = root / 'modules/core/include/opencv2/core/hal/intrin_wasm.hpp'
update(path, path.read_text().replace('    double v_[4];\n    wasm_v128_store(v_, v.val);', '    float v_[4];\n    wasm_v128_store(v_, v.val);'))

path = root / 'modules/features/src/annoy.cpp'
text = path.read_text()
if 'OpenCVAnnoyBuildPolicy' not in text:
    text = text.replace('#define ANNOYLIB_MULTITHREADED_BUILD', '#ifndef __EMSCRIPTEN__\n#define ANNOYLIB_MULTITHREADED_BUILD\n#endif')
    text = text.replace('::cvannoy::AnnoyIndexMultiThreadedBuildPolicy', 'OpenCVAnnoyBuildPolicy')
    text = text.replace('namespace cv\n{', '''namespace cv
{
// The WASM build executes CPU algorithms without native worker threads.
#ifdef __EMSCRIPTEN__
using OpenCVAnnoyBuildPolicy = ::cvannoy::AnnoyIndexSingleThreadedBuildPolicy;
#else
using OpenCVAnnoyBuildPolicy = ::cvannoy::AnnoyIndexMultiThreadedBuildPolicy;
#endif''')
update(path, text)

path = Path('vendor/opencv_contrib-5.0.0/modules/sfm/include/opencv2/sfm/simple_pipeline.hpp')
text = path.read_text()
if 'polynomial_p1(_polynomial_p1)' not in text:
    text = text.replace('      division_k1(_polynomial_p1),', '      polynomial_p1(_polynomial_p1),\n      polynomial_p2(_polynomial_p2),\n      division_k1(_polynomial_p1),')
update(path, text)

path = root / 'cmake/OpenCVBindingsPreprocessorDefinitions.cmake'
update(path, path.read_text().replace('ocv_add_definition(CERES_FOUND 0)', 'ocv_add_definition(CERES_FOUND 1)'))

path = Path('vendor/opencv_contrib-5.0.0/modules/sfm/CMakeLists.txt')
text = path.read_text()
if 'WASM reconstruction requires Ceres' not in text:
    text = text.replace('find_package(Ceres QUIET)', 'find_package(Ceres QUIET)\nif(EMSCRIPTEN AND NOT Ceres_FOUND)\n  message(FATAL_ERROR "WASM reconstruction requires Ceres")\nendif()')
update(path, text)

path = root / 'modules/core/include/opencv2/core/utils/filesystem.private.hpp'
text = path.read_text().replace('#  if defined(__EMSCRIPTEN__) || defined(__native_client__)', '#  if defined(__EMSCRIPTEN__)\n#    define OPENCV_HAVE_FILESYSTEM_SUPPORT 1\n#  elif defined(__native_client__)')
update(path, text)

path = root / 'modules/js/common.cmake'
text = path.read_text()
text = text.replace('MATCHES ";js;"', 'MATCHES ";(js|python);"')
update(path, text)

path = root / 'modules/js/generator/CMakeLists.txt'
text = path.read_text()
if '/work/scripts/graph-typed-kernels.cpp' not in text:
    text = text.replace('  DEPENDS\n', '  DEPENDS\n      /work/scripts/graph-typed-kernels.cpp\n')
if '/work/scripts/graph-inference.cpp' not in text:
    text = text.replace('  DEPENDS\n', '  DEPENDS\n      /work/scripts/graph-inference.cpp\n')
if '/work/scripts/graph-kernels.cpp' not in text:
    text = text.replace('  DEPENDS\n', '  DEPENDS\n      /work/scripts/callback-bridge.hpp\n      /work/scripts/graph-kernels.cpp\n')
if '/work/scripts/expand_bindings.py' not in text:
    text = text.replace('  DEPENDS\n', '  DEPENDS\n      /work/scripts/expand_bindings.py\n      /work/scripts/extra-bindings.cpp\n      /work/scripts/graph-bindings.cpp\n      /work/scripts/dnn-bindings.cpp\n')
marker = '# header blacklist'
if 'modules/highgui/' not in text:
    text = text.replace(marker, marker + '\nocv_list_filterout(opencv_hdrs "modules/highgui/")')
update(path, text)

path = root / 'cmake/OpenCVModule.cmake'
text = path.read_text()
marker = '      if(wrapper STREQUAL "python")  # hack for python (BINDINDS)'
if 'opencv_js OPTIONAL' not in text:
    text = text.replace(marker, marker + '\n        ocv_add_dependencies(opencv_js OPTIONAL ${the_module})')
if 'opencv_js_bindings_generator OPTIONAL' not in text:
    text = text.replace(marker, marker + '\n        ocv_add_dependencies(opencv_js_bindings_generator OPTIONAL ${the_module})')
update(path, text)

path = root / 'modules/js/CMakeLists.txt'
text = path.read_text()
if '# Native DNN graph backend' not in text:
    text = text.replace('add_dependencies(${the_module} gen_opencv_js_source)', '''add_dependencies(${the_module} gen_opencv_js_source)
# Native DNN graph backend uses the pinned internal G-API backend interface.
target_include_directories(${the_module} PRIVATE "/work/vendor/opencv_contrib-5.0.0/modules/gapi/src")
target_link_libraries(${the_module} PRIVATE ade)''')
text = text.replace('set(JS_HELPER "${CMAKE_CURRENT_SOURCE_DIR}/src/helpers.js")', 'set(JS_HELPER "/work/scripts/native-runtime.js")')
marker = 'set_target_properties(${the_module} PROPERTIES LINK_FLAGS'
if '--emit-tsd' not in text:
    text = text.replace(marker, '''set(EMSCRIPTEN_LINK_FLAGS "${EMSCRIPTEN_LINK_FLAGS} -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sDISABLE_EXCEPTION_CATCHING=0 -sEXPORTED_FUNCTIONS=_malloc,_free -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,HEAP8,HEAPU16,HEAP16,HEAP32,HEAPU32,HEAPF32,HEAPF64 --emit-tsd ${OpenCV_BINARY_DIR}/bin/opencv.d.ts")
''' + marker)
update(path, text)

path = root / 'modules/js/generator/embindgen.py'
text = path.read_text()
if 'self.isparams = True' not in text:
    text = text.replace('                elif m == "/Simple":', '                elif m == "/Params":\n                    self.isparams = True\n                elif m == "/Simple":')
text = text.replace('        for hdr in src_files:\n            decls', '        for hdr in src_files:\n            if ".private." in hdr:\n                continue\n            decls')
marker = '        self.resolve_class_inheritance()'
if 'expand_bindings' not in text:
    text = text.replace(marker, '''        sys.path.insert(0, '/work/scripts')
        from expand_bindings import prepare
        prepare(self, globals(), dst_file, headers, core_bindings)
''' + marker)
update(path, text)
