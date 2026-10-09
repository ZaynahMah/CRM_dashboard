#!/usr/bin/env bash
# Static checks (scenario 15): things grep can prove without a database.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0

echo "== No DELETE/UPDATE without WHERE in supabase/*.sql =="
python3 - <<'PY' || fail=1
import re, glob, sys
bad=[]
for f in sorted(glob.glob('supabase/*.sql')):
    L=open(f).read().split('\n')
    for i,ln in enumerate(L,1):
        h=ln.strip().lower()
        if h.startswith('--') or not re.match(r'^(delete\s+from|update)\s+[a-z_."]+',h): continue
        j,buf=i-1,''
        while j<len(L) and ';' not in buf: buf+=' '+L[j].strip().lower(); j+=1
        if ' where ' not in buf: bad.append(f"{f}:{i} {ln.strip()}")
print('\n'.join('   '+b for b in bad) if bad else '   none')
sys.exit(1 if bad else 0)
PY

echo "== No .insert()/.delete() on campaigns in src/ =="
if grep -rn 'from("campaigns")' src/ | grep -E '\.insert\(|\.delete\('; then
  echo "   FOUND — the reset RPC must be the only write path"; fail=1
else echo "   none"; fi

echo "== Every supabase.rpc() name exists in supabase/*.sql =="
python3 - <<'PY' || fail=1
import re, glob, sys
sql="".join(open(f).read() for f in glob.glob('supabase/*.sql')).lower()
calls=set()
for f in glob.glob('src/**/*.ts*', recursive=True):
    for m in re.finditer(r'\.rpc\(\s*["\']([a-z_0-9]+)["\']', open(f).read()):
        calls.add(m.group(1))
missing=[c for c in sorted(calls) if f'function public.{c}' not in sql and f'function {c}' not in sql]
print('   calls:', ', '.join(sorted(calls)))
print('   MISSING:', missing if missing else 'none')
sys.exit(1 if missing else 0)
PY

echo "== Paged reads: listCampaigns must not stop at 1,000 =="
if grep -q "range(" src/services/campaigns.ts; then echo "   paging present"; else
  echo "   NO .range() — a 1,000-row cap would silently truncate"; fail=1; fi

echo
[ "$fail" -eq 0 ] && echo "STATIC QC: PASS" || echo "STATIC QC: FAIL"
exit $fail
