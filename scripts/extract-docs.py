"""Capture Doxygen text and declarations from the exact headers used by this build."""
import json
import re
import sys
import contextlib
import io
from bisect import bisect_right
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'vendor/opencv-5.0.0/modules/python/src2'))
from hdr_parser import CppHeaderParser

entries = []
class Parser(CppHeaderParser):
    def parse_stmt(self, stmt, end_token, mat='Mat', docstring=''):
        result = super().parse_stmt(stmt, end_token, mat, docstring)
        decl = result[3]
        source = str(Path(self.hname).relative_to(root))
        if end_token == '{' and result[0].startswith('enum'):
            entries.append({'name': self.get_dotted_name(result[1]), 'kind': 'enum', 'doc': docstring,
                            'return': '', 'parameters': [], 'modifiers': [], 'source': source, 'line': self.lineno + 1})
        if decl and isinstance(decl[0], list):
            for constant in decl:
                entries.append({'name': constant[0].removeprefix('const '), 'kind': 'constant', 'doc': '', 'return': constant[1],
                                'parameters': [], 'modifiers': [], 'source': source, 'line': self.lineno + 1,
                                'enum': self.get_dotted_name(result[1])})
            return result
        if decl:
            name = decl[0]
            kind = 'function'
            if name.startswith(('class ', 'struct ')):
                kind, name = name.split(' ', 1)
            if name.startswith('enum '):
                kind, name = name.split(' ', 1)
            entries.append({'name': name, 'kind': kind, 'doc': decl[5] if len(decl) > 5 else docstring,
                            'return': decl[1], 'parameters': decl[3], 'modifiers': decl[2], 'source': source, 'line': self.lineno + 1})
        elif 'CV_PROP' in stmt and self.block_stack:
            parent = self.block_stack[-1][self.CLASS_DECL]
            if parent:
                name = parent[0].split(' ', 1)[-1]
                for prop in parent[3]:
                    if re.search(r'\b' + re.escape(prop[1]) + r'\b', stmt):
                        entries.append({'name': name + '.' + prop[1], 'kind': 'property', 'doc': docstring,
                                        'return': prop[0], 'parameters': [], 'modifiers': prop[3], 'source': source, 'line': self.lineno + 1})
        return result

config = json.loads((root / 'build/wasm5/modules/js_bindings_generator/gen_js_config.json').read_text())
headers = [root / name.removeprefix('/work/') for name in config['headers'] if '.private.' not in name]
parser = Parser(preprocessor_definitions=config.get('preprocessor_definitions', {}))
for header in headers:
    parser.parse(str(header))

# Unwrapped overloads often contain the main documentation, with wrapped
# overloads only saying @overload. They are documentation sources, not exports.
supplemental_failures = []
for header in headers:
    start = len(entries)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            Parser(preprocessor_definitions=config.get('preprocessor_definitions', {})).parse(str(header), wmode=False)
    except (Exception, SystemExit) as error:
        del entries[start:]
        supplemental_failures.append({'source': str(header.relative_to(root)), 'error': str(error)})

# Capture short enum/member comments that the binding parser deliberately discards.
comments = {}
for header in headers:
    text = header.read_text()
    for match in re.finditer(r'\b(\w+)\s*(?:=[^\n]*?)?[,;]\s*(?://[/!]?<?|/\*[*!]?<?)\s*([^\n]+)', text):
        comment = match[2].removesuffix('*/').strip()
        if comment:
            comments.setdefault(str(header.relative_to(root)), {})[match[1]] = comment

destination = root / 'build/api-docs.json'
# Preserve adjacent documentation blocks and //! comments; the upstream binding
# parser keeps only the last /** block and omits single-line documentation.
sources = {}
for entry in entries:
    path = entry['source']
    if path not in sources:
        source = (root / path).read_text()
        offsets = [0] + [m.end() for m in re.finditer('\n', source)]
        blocks = list(re.finditer(r'/\*[\s\S]*?\*/|//[^\n]*', source))
        sources[path] = source, offsets, blocks, [m.end() for m in blocks]
    source, offsets, blocks, ends = sources[path]
    boundary = offsets[min(entry['line'] - 1, len(offsets) - 1)]
    short = entry['name'].split('.')[-1]
    pattern = r'\b' + re.escape(short) + (r'\s*\(' if entry['kind'] == 'function' else r'\b')
    matches = list(re.finditer(pattern, source[:boundary]))
    if not matches:
        continue
    position = matches[-1].start()
    start = source.rfind('\n', 0, position) + 1
    entry['line'] = bisect_right(offsets, start)
    index = bisect_right(ends, start) - 1
    collected = []
    cursor = start
    while index >= 0 and not source[blocks[index].end():cursor].strip():
        block = blocks[index]
        text = block.group()
        if text.startswith('/*'):
            text = text[2:-2].lstrip('*!<')
        else:
            text = text[2:].lstrip('/!<')
        collected.insert(0, text.strip())
        cursor = block.start()
        index -= 1
    if collected:
        entry['doc'] = '\n'.join(collected)
    if entry['kind'] in {'constant', 'property'}:
        line = source[start:source.find('\n', position)]
        trailing = re.search(r'(?://[/!]?<?|/\*[*!]?<?)\s*(.*)', line)
        if trailing:
            entry['doc'] = trailing[1].removesuffix('*/').strip()
destination.write_text(json.dumps({'entries': entries, 'comments': comments, 'supplementalFailures': supplemental_failures}, ensure_ascii=False, indent=2) + '\n')
print(f'Captured {len(entries)} upstream declarations and {sum(len(v) for v in comments.values())} member comments')
