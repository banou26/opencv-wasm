"""Targeted portability changes to the checksum-pinned upstream sources."""
from pathlib import Path

path = Path('vendor/dependencies/hdf5-1.14.5/src/H5Tinit_float.c')
text = path.read_text()
block = '''    if (feclearexcept(FE_INVALID) != 0)
        HSYS_GOTO_ERROR(H5E_DATATYPE, H5E_CANTSET, FAIL, "can't clear floating-point exceptions");'''
if '#ifdef FE_INVALID' not in text:
    text = text.replace(block, '#ifdef FE_INVALID\n' + block + '\n#endif')
    path.write_text(text)

path = Path('vendor/dependencies/glog-0.6.0/src/glog/platform.h')
text = path.read_text()
if 'GLOG_OS_EMSCRIPTEN' not in text:
    text = text.replace('#else\n// TODO(hamaji)', '#elif defined(__EMSCRIPTEN__)\n#define GLOG_OS_EMSCRIPTEN\n#else\n// TODO(hamaji)')
    path.write_text(text)
