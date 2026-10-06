// Dependency-free lint: syntax-checks every .js/.mjs file with `node --check`. (agent-generated)
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const skip = new Set(['node_modules', '.git']);
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(name)) files.push(p);
  }
})('.');

let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error(`syntax error in ${f}\n${r.stderr}`); }
}
console.log(bad ? `lint failed: ${bad} file(s)` : `lint ok (${files.length} files)`);
process.exit(bad ? 1 : 0);
