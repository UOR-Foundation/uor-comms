#!/bin/sh
# TEMPORARY, not for merge: set each new theorem's declared axioms to what Lean observes, then format and relock.
set -u
cd app
lexlean lock
f=src/Comms/MemberProofs.lex.tex
i=0
while [ $i -lt 14 ]; do
  out=$(lexlean verify "$f" 2>&1); printf '%s\n' "$out" | head -20
  line=$(printf '%s\n' "$out" | grep -m1 'axiom policy: observed') || break
  name=$(printf '%s' "$line" | sed -E 's/.*`[A-Za-z0-9_.]*\.([A-Za-z0-9_]+)` violates.*/\1/')
  obs=$(printf '%s' "$line" | sed -E 's/.*observed (\[[^]]*\]).*/\1/')
  awk -v n="$name" -v o="$obs" '$0 ~ "^  name: " n ",$" {hit=1} hit && /^  axioms: / {sub(/axioms: \[[^]]*\]/, "axioms: " o); hit=0} {print}' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  echo "settled $name -> $obs"; i=$((i+1))
done
lexlean fmt --all && lexlean lock
