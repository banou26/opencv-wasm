"""Keep derived-class overload dispatch local to the derived prototype."""
from pathlib import Path

root = Path('/emsdk/upstream/emscripten/src/lib')
path = root / 'libembind.js'
text = path.read_text()
old = 'var method = proto[methodName];'
assert text.count(old) == 1
text = text.replace(old, 'var method = Object.prototype.hasOwnProperty.call(proto, methodName) ? proto[methodName] : undefined;')
path.write_text(text)

path = root / 'libembind_gen.js'
text = path.read_text().replace('${getTypeName(typeId)}', '${Object.keys(awaitingDependencies).map(getTypeName).join(", ")}')
path.write_text(text)
