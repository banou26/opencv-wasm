"""Inventory the pinned Python wheel for API comparisons; never used at runtime."""
import inspect
import json
from pathlib import Path
import types
import cv2

entries = {}
seen = set()

def walk(module, path):
    if id(module) in seen:
        return
    seen.add(id(module))
    for name in dir(module):
        if name.startswith('_'):
            continue
        value = getattr(module, name)
        full = path + '.' + name
        if isinstance(value, types.ModuleType):
            if value.__name__.startswith('cv2'):
                entries[full] = {'kind': 'module'}
                walk(value, full)
        elif inspect.isclass(value) and getattr(value, '__module__', '').startswith('cv2'):
            members = {}
            for member in dir(value):
                if member.startswith('_'):
                    continue
                attr = getattr(value, member)
                members[member] = 'method' if callable(attr) else 'property'
            entries[full] = {'kind': 'class', 'members': members}
        elif callable(value) and (inspect.isbuiltin(value) or getattr(value, '__module__', '').startswith('cv2')):
            entries[full] = {'kind': 'function'}
        elif isinstance(value, (int, float, str)):
            entries[full] = {'kind': 'constant', 'value': value}

walk(cv2, 'cv2')
Path('scripts/reference/python-5.0.0.json').write_text(json.dumps({'package': 'opencv-contrib-python-headless', 'packageVersion': '5.0.0.93', 'version': cv2.__version__, 'entries': entries}, indent=2) + '\n')
Path('.cache/python-build.txt').write_text(cv2.getBuildInformation())
print(f'Inventoried {len(entries)} Python names')
print('Namespaces:', ', '.join(p[4:] for p, e in entries.items() if e['kind'] == 'module'))
