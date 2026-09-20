"""Include upstream notices alongside the distributed native binary."""
from pathlib import Path
import re
import shutil

output = Path('lib/licenses')
for old in output.glob('opencv*'):
    if old.is_dir():
        shutil.rmtree(old)
projects = [Path('vendor') / name for name in ['opencv-5.0.0', 'opencv_contrib-5.0.0']]
projects += sorted(Path('vendor/dependencies').iterdir())
for source in projects:
    project = source.name
    shutil.rmtree(output / project, ignore_errors=True)
    for file in source.rglob('*'):
        if file.is_file() and (re.match(r'^(license|licence|copying|copyright)($|[._-])', file.name.lower()) or file.name in {'README.ijg', 'FTL.TXT', 'GPLv2.TXT'}):
            target = output / project / file.relative_to(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, target)
ade = Path('build/wasm5/3rdparty/ade/ade-0.1.2e/LICENSE')
if ade.is_file():
    shutil.copyfile(ade, output / 'ade.txt')
for name, source in {
    'emscripten.txt': '/emsdk/upstream/emscripten/LICENSE',
    'musl.txt': '/emsdk/upstream/emscripten/system/lib/libc/musl/COPYRIGHT',
    'eigen.txt': '/usr/share/doc/libeigen3-dev/copyright',
    'MPL-2.0.txt': '/usr/share/common-licenses/MPL-2.0',
}.items():
    if Path(source).is_file():
        output.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, output / name)
