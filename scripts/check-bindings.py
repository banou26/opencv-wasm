"""Compile-check generated wrappers without rebuilding the OpenCV archives."""
import re
import shlex
import subprocess
from pathlib import Path

root = Path('/work')
text = (root / 'build/wasm5/modules/js/CMakeFiles/opencv_js.dir/flags.make').read_text()
flags = ' '.join(re.findall(r'CXX_(?:DEFINES|INCLUDES|FLAGS) = (.*)', text))
subprocess.run(['em++', *shlex.split(flags), '-fsyntax-only', '-ferror-limit=40', '-Wno-deprecated-declarations', '/work/build/wasm5/modules/js_bindings_generator/gen/bindings.cpp'], cwd=root / 'build/wasm5/modules/js', check=True)
