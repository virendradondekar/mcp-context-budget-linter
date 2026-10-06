// Smoke test: starts the app in MOCK_MODE with a scrubbed environment (no credentials) and
// checks that key routes return the expected status. Config: smoke.config.json. (agent-generated)
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cfg = JSON.parse(readFileSync(new URL('../smoke.config.json', import.meta.url), 'utf8'));
const port = 20000 + Math.floor(Math.random() * 20000);
const tmp = mkdtempSync(join(tmpdir(), 'smoke-'));
const base = `http://127.0.0.1:${port}`;
const [cmd, ...args] = cfg.start ?? ['node', 'server.js'];

const child = spawn(cmd, args, {
  cwd: new URL('..', import.meta.url),
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), MOCK_MODE: '1', AI_PROVIDER: 'rules', DB_FILE: join(tmp, 'db.json'), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', (d) => (logs += d));
child.stderr.on('data', (d) => (logs += d));
let exited = null;
child.on('exit', (c) => (exited = c));

const done = (code, msg) => {
  if (msg) console[code ? 'error' : 'log'](msg);
  if (code && logs) console.error('--- app output ---\n' + logs.slice(-2000));
  child.kill();
  rmSync(tmp, { recursive: true, force: true });
  process.exit(code);
};

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    if (exited !== null) done(1, `FAIL: server exited early with code ${exited}`);
    try { if ((await fetch(base + '/health')).status === 200) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  done(1, 'FAIL: server did not answer GET /health within 15s');
}

await waitReady();
let failed = 0;
for (const r of cfg.routes) {
  const method = r.method ?? 'GET';
  const want = r.status ?? 200;
  try {
    const res = await fetch(base + r.path, { method, headers: { 'content-type': 'application/json' }, body: r.body ? JSON.stringify(r.body) : undefined });
    const ok = res.status === want;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${method} ${r.path} -> ${res.status} (want ${want})`);
    if (!ok) failed++;
  } catch (e) { console.log(`FAIL ${method} ${r.path} -> ${e.message}`); failed++; }
}
done(failed ? 1 : 0, failed ? `${failed} smoke check(s) failed` : `smoke ok (${cfg.routes.length} routes, mock mode)`);
