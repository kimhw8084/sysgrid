"""Release maintainer tool; intentionally not installed with the runtime."""
from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parent.parent
files=[]
for path in sorted(root.rglob('*')):
    if not path.is_file() or path.is_symlink():continue
    rel=path.relative_to(root).as_posix()
    if rel=='PACKAGE_SHA256.json' or '/__pycache__/' in '/'+rel or rel.endswith(('.pyc','.pyo')):continue
    data=path.read_bytes()
    files.append({'path':rel,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
identity=json.loads((root/'data/release_identity.json').read_text(encoding='utf-8'))
manifest={'package':identity['package'],'version':identity['version'],'status':identity['release_status'],'source':identity['source_lineage'],'files':files}
(root/'PACKAGE_SHA256.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
print('Manifest covers',len(files),'files')
