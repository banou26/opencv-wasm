"""Fetch and extract the pinned CPU dependencies used by the WASM build."""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

for name, source in json.loads(Path('scripts/dependencies.json').read_text()).items():
    archive = Path('.cache/dependencies') / (name + '.tar.gz')
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        subprocess.run(['curl', '-fL', '--retry', '3', source['url'], '-o', str(archive)], check=True)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != source['sha256']:
        raise RuntimeError('Source checksum mismatch: ' + name)
    destination = Path('vendor/dependencies') / name
    if not destination.exists():
        destination.mkdir(parents=True)
        with tarfile.open(archive) as source_tar:
            for member in source_tar.getmembers():
                member.name = '/'.join(member.name.split('/')[1:])
                if member.name:
                    source_tar.extract(member, destination, filter='data')
