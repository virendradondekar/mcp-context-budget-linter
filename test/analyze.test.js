import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze, normalizeTools, estimateTokens } from '../lib/analyze.js';
import { suggestRewrite } from '../lib/rewrite.js';

const sample = JSON.parse(readFileSync(new URL('../fixtures/sample-tools.json', import.meta.url), 'utf8'));
const codes = (result, name) => result.tools.find((t) => t.name === name).issues.map((i) => i.code);

test('estimateTokens is chars/4 rounded up', () => {
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
  assert.equal(estimateTokens(undefined), 0);
});

test('normalizeTools accepts array, {tools}, JSON-RPC, and strings; rejects junk', () => {
  const t = [{ name: 'a' }];
  assert.equal(normalizeTools(t).length, 1);
  assert.equal(normalizeTools({ tools: t }).length, 1);
  assert.equal(normalizeTools({ jsonrpc: '2.0', id: 1, result: { tools: t } }).length, 1);
  assert.equal(normalizeTools(JSON.stringify(t)).length, 1);
  assert.throws(() => normalizeTools('{nope'), /valid JSON/);
  assert.throws(() => normalizeTools({}), /Expected/);
  assert.throws(() => normalizeTools([]), /empty/);
  assert.throws(() => normalizeTools([{ description: 'x' }]), /name/);
});

test('sample fixture triggers the intended issues', () => {
  const r = analyze(sample, { budget: 2000 });
  assert.equal(r.toolCount, 6);
  assert.ok(codes(r, 'run_report').includes('missing-description'));
  assert.ok(codes(r, 'do_stuff').includes('vague-description'));
  assert.ok(codes(r, 'find_documents').includes('near-duplicate'));
  assert.ok(codes(r, 'export_data').includes('long-description'));
  assert.ok(codes(r, 'export_data').includes('big-enum'));
  assert.ok(codes(r, 'export_data').includes('deep-schema'));
  assert.ok(codes(r, 'createTicket').includes('naming-style'));
  assert.ok(codes(r, 'createTicket').includes('undocumented-params'));
});

test('results are sorted by cost and totals add up', () => {
  const r = analyze(sample);
  const sorted = [...r.tools].sort((a, b) => b.tokens.total - a.tokens.total);
  assert.deepEqual(r.tools.map((t) => t.name), sorted.map((t) => t.name));
  assert.equal(r.totalTokens, r.tools.reduce((n, t) => n + t.tokens.total, 0));
});

test('budget handling', () => {
  assert.equal(analyze(sample, { budget: 10 }).overBudget, true);
  assert.equal(analyze(sample, { budget: 10_000_000 }).overBudget, false);
  assert.equal(analyze(sample, { budget: 'abc' }).budget, 8000);
});

test('a clean tool has no issues', () => {
  const r = analyze([{ name: 'get_weather', description: 'Get the current weather for a city. Use when the user asks about conditions. Returns temperature and summary.', inputSchema: { type: 'object', properties: { city: { type: 'string', description: 'City name' } } } }]);
  assert.deepEqual(r.tools[0].issues, []);
  assert.equal(r.health, 100);
});

test('suggestRewrite: template for missing, trim for long, keep for good', () => {
  assert.match(suggestRewrite({ name: 'run_report' }).description, /Run report\. Use when/);
  const long = suggestRewrite({ name: 'x', description: 'First sentence. ' + 'More words here. '.repeat(40) });
  assert.ok(long.description.length <= 300);
  const good = 'Get the current weather for a city. Use when asked about conditions.';
  assert.equal(suggestRewrite({ name: 'w', description: good }).description, good);
});