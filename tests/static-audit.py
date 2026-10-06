from pathlib import Path
import re, subprocess, json
root=Path(__file__).resolve().parents[1]; missing=[];syntax=[];counts={}
for app in ['app','ais-center']:
 base=root/app;counts[app]={e:len(list(base.rglob('*.'+e))) for e in ['html','js','css']}
 for p in base.rglob('*.html'):
  s=p.read_text(); refs=re.findall(r'(?:src|href)=[\"\']([^\"\']+)',s)
  for ref in refs:
   if re.match(r'^(?:https?:|data:|#|mailto:|tel:|javascript:)',ref):continue
   ref=ref.split('?')[0].split('#')[0]
   if not ref:continue
   q=base/ref.lstrip('/') if ref.startswith('/') else p.parent/ref
   if not q.exists():missing.append([str(p.relative_to(root)),ref])
 for p in base.rglob('*.js'):
  r=subprocess.run(['node','--input-type=module','--check'],input=p.read_text(),text=True,capture_output=True)
  if r.returncode:syntax.append([str(p.relative_to(root)),r.stderr])
  for ref in re.findall(r'(?:from\s+|import\s*)[\"\'](\.[^\"\']+)',p.read_text()):
   if not (p.parent/ref).exists():missing.append([str(p.relative_to(root)),ref])
print(json.dumps({'counts':counts,'missing':missing,'syntax':syntax},ensure_ascii=False,indent=2))
