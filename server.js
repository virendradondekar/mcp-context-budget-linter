import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './lib/analyze.js';
import { suggestRewrite } from './lib/rewrite.js';
import { createAI } from './ai-provider.js';
import { load, save } from './store.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 1024 * 1024;

const ai = createAI({ rules: (tool) => JSON.stringify(suggestRewrite(tool)) });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large (max 1 MB)'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Request body is not valid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.join(publicDir, path.normalize(rel));
  if (!file.startsWith(publicDir + path.sep)) return send(res, 404, { error: 'Not found' });
  try {
    send(res, 200, await readFile(file), TYPES[path.extname(file)] ?? 'application/octet-stream');
  } catch { send(res, 404, { error: 'Not found' }); }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/health') return send(res, 200, { ok: true });
    if (pathname === '/api/sample' && req.method === 'GET') {
      return send(res, 200, await readFile(path.join(root, 'fixtures', 'sample-tools.json'), 'utf8'));
    }
    if (pathname === '/api/history' && req.method === 'GET') return send(res, 200, { history: load({ history: [] }).history });
    if (pathname === '/api/analyze' && req.method === 'POST') {
      const body = await readBody(req);
      let result;
      try { result = analyze(body.tools ?? body, { budget: body.budget }); }
      catch (e) { return send(res, 400, { error: e.message }); }
      const db = load({ history: [] });
      db.history = [{ at: new Date().toISOString(), toolCount: result.toolCount, totalTokens: result.totalTokens, budget: result.budget, health: result.health }, ...db.history].slice(0, 20);
      save(db);
      return send(res, 200, result);
    }
    if (pathname === '/api/suggest' && req.method === 'POST') {
      const { tool } = await readBody(req);
      if (!tool || typeof tool.name !== 'string') return send(res, 400, { error: 'Body must be {"tool":{"name":...}}' });
      const prompt = `Rewrite this MCP tool description to be concise (under 300 characters), say when to use the tool and what it returns. Reply with the new description only.\n\n${JSON.stringify({ name: tool.name, description: tool.description ?? '' })}`;
      const r = await ai.ask({ system: 'You improve MCP tool descriptions for AI agents.', prompt, input: tool });
      if (r.provider === 'rules') return send(res, 200, { provider: 'rules', ...JSON.parse(r.text), ...(r.fallbackReason ? { fallbackReason: r.fallbackReason } : {}) });
      return send(res, 200, { provider: r.provider, description: r.text.trim(), notes: ['Written by an AI provider; review before using.'] });
    }
    if (req.method === 'GET') return serveStatic(res, pathname);
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, e.status ?? 500, { error: e.status ? e.message : 'Internal error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`mode: ${ai.provider === 'rules' ? 'mock (rules provider)' : `live (${ai.provider})`}${ai.fallbackReason ? ` [${ai.fallbackReason}]` : ''}`);
  console.log(`MCP Context Budget Linter listening on http://${HOST}:${PORT}`);
});