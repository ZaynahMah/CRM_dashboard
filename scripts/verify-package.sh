#!/usr/bin/env bash
# Verifies that every file in MANIFEST.txt is tracked by Git BEFORE you push.
#
# This exists because two Vercel deploys have failed on files that were in the
# delivered zip but never reached GitHub: first src/types/user.ts, then
# src/lib/workflow.ts, src/services/campaigns.ts and src/services/exportExcel.ts.
# Both times the symptom was "Module not found" minutes after the push. This
# catches it in about a second, before the push.
#
# Usage:  bash scripts/verify-package.sh
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0

echo "== 1. Files in MANIFEST.txt that Git does not know about =="
missing=$(comm -23 <(grep -v '^MANIFEST.txt$' MANIFEST.txt | sort) <(git ls-files | sort))
if [ -n "$missing" ]; then echo "$missing" | sed 's/^/   MISSING FROM GIT: /'; fail=1; else echo "   none"; fi

echo; echo "== 2. Files on disk that Git does not know about =="
untracked=$(git ls-files --others --exclude-standard)
if [ -n "$untracked" ]; then echo "$untracked" | sed 's/^/   UNTRACKED: /'; fail=1; else echo "   none"; fi

echo; echo "== 3. Tracked files with uncommitted changes =="
dirty=$( (git diff --name-only; git diff --cached --name-only) | sort -u )
if [ -n "$dirty" ]; then echo "$dirty" | sed 's/^/   UNCOMMITTED: /'; fail=1; else echo "   none"; fi

echo; echo "== 4. Every @/ import resolves, with exact casing =="
node -e '
const fs=require("fs"),path=require("path");
const walk=(d,o=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
 e.isDirectory()?walk(p,o):/\.tsx?$/.test(e.name)&&o.push(p);}return o;};
let bad=0;
for(const f of walk("src")){const s=fs.readFileSync(f,"utf8");
 for(const m of s.matchAll(/from ["\x27]@\/([^"\x27]+)["\x27]/g)){
  const b=path.join("src",m[1]);
  const hit=[".ts",".tsx",".json","/index.ts",""].map(e=>b+e).find(c=>fs.existsSync(c));
  if(!hit){console.log("   UNRESOLVED: "+f+" -> @/"+m[1]);bad++;continue;}
  const d=path.dirname(hit),n=path.basename(hit);
  if(fs.existsSync(d)&&!fs.readdirSync(d).includes(n)){console.log("   CASE MISMATCH: "+f+" -> "+n);bad++;}
 }}
if(!bad)console.log("   all resolve, casing exact");
process.exit(bad?1:0);'
[ $? -ne 0 ] && fail=1

echo
if [ "$fail" -eq 0 ]; then
  echo "PASS - safe to push."
else
  echo "FAIL - do NOT push. Fix with:  git add -A && git commit -m 'Add missing files' && git push"
  exit 1
fi
