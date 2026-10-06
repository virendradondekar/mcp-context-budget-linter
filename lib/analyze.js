// Pure analysis logic for MCP tool definitions. No I/O.

/** Rough token estimate: ~4 characters per token. Relative, not exact. */
export const estimateTokens = (value) => Math.ceil(String(value ?? '').length / 4);

const VAGUE_START = /^(does|do|handles?|manages?|utility|helper|tool|misc|various|stuff|thing|general)\b/i;
const DEFAULT_BUDGET = 8000;
const LIMITS = { longDescChars: 600, shortDescChars: 20, schemaTokens: 800, paramDescChars: 200, enumSize: 20, depth: 3 };

/** Accepts: array of tools, {tools:[...]}, or a JSON-RPC response {result:{tools:[...]}}; string or object. */
export function normalizeTools(input) {
  let v = input;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { throw new Error('Input is not valid JSON'); }
  }
  let tools;
  if (Array.isArray(v)) tools = v;
  else if (Array.isArray(v?.tools)) tools = v.tools;
  else if (Array.isArray(v?.result?.tools)) tools = v.result.tools;
  if (!tools) throw new Error('Expected a tools array, {"tools":[...]}, or a JSON-RPC tools/list response');
  if (tools.length === 0) throw new Error('The tools list is empty');
  if (tools.length > 500) throw new Error('Too many tools (max 500)');
  tools.forEach((t, i) => {
    if (!t || typeof t !== 'object' || typeof t.name !== 'string' || !t.name.trim()) throw new Error(`Tool #${i + 1} has no string "name"`);
  });
  return tools;
}

export const schemaOf = (t) => t.inputSchema ?? t.input_schema ?? t.parameters ?? {};

function walkSchema(schema) {
  const out = { params: 0, undocumented: [], maxDepth: 0, bigEnums: [], longParamDescs: [] };
  (function visit(node, depth, path) {
    if (!node || typeof node !== 'object') return;
    out.maxDepth = Math.max(out.maxDepth, depth);
    if (Array.isArray(node.enum) && node.enum.length > LIMITS.enumSize) out.bigEnums.push(path || '(root)');
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      out.params++;
      const p = path ? `${path}.${key}` : key;
      if (!child || typeof child.description !== 'string' || !child.description.trim()) out.undocumented.push(p);
      else if (child.description.length > LIMITS.paramDescChars) out.longParamDescs.push(p);
      visit(child, depth + 1, p);
    }
    if (node.items) visit(node.items, depth + 1, `${path}[]`);
  })(schema, 0, '');
  return out;
}

const words = (s) => new Set(String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9]{2,}/g) ?? []);
function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

const styleOf = (name) => (name.includes('_') ? 'snake_case' : name.includes('-') ? 'kebab-case' : /[a-z][A-Z]/.test(name) ? 'camelCase' : 'single-word');

export function analyze(input, { budget } = {}) {
  const tools = normalizeTools(input);
  const limit = Number.isFinite(Number(budget)) && Number(budget) > 0 ? Math.floor(Number(budget)) : DEFAULT_BUDGET;

  const rows = tools.map((t) => {
    const desc = typeof t.description === 'string' ? t.description.trim() : '';
    const schema = schemaOf(t);
    const walk = walkSchema(schema);
    const tokens = { name: estimateTokens(t.name), description: estimateTokens(desc), schema: estimateTokens(JSON.stringify(schema)) };
    tokens.total = tokens.name + tokens.description + tokens.schema;
    const issues = [];
    const add = (code, severity, message, saves = 0) => issues.push({ code, severity, message, saves });

    if (!desc) add('missing-description', 'high', 'No description: the model cannot tell when to use this tool.');
    else {
      if (desc.length < LIMITS.shortDescChars || VAGUE_START.test(desc) && desc.length < 40) add('vague-description', 'medium', `Description is vague or very short ("${desc.slice(0, 40)}"). Say when to use it and what it returns.`);
      if (desc.length > LIMITS.longDescChars) add('long-description', 'medium', `Description is ${desc.length} characters; trim to the essentials (when to use, what it returns).`, tokens.description - estimateTokens(desc.slice(0, 300)));
    }
    if (tokens.schema > LIMITS.schemaTokens) add('oversized-schema', 'high', `Input schema costs about ${tokens.schema} tokens; consider fewer or simpler parameters.`, tokens.schema - LIMITS.schemaTokens);
    if (walk.undocumented.length) add('undocumented-params', 'medium', `${walk.undocumented.length} parameter(s) without a description: ${walk.undocumented.slice(0, 5).join(', ')}${walk.undocumented.length > 5 ? ', …' : ''}.`);
    if (walk.longParamDescs.length) add('long-param-description', 'low', `Long parameter description(s) over ${LIMITS.paramDescChars} chars: ${walk.longParamDescs.slice(0, 3).join(', ')}.`);
    if (walk.maxDepth > LIMITS.depth) add('deep-schema', 'low', `Schema nests ${walk.maxDepth} levels deep; flatten where possible.`);
    if (walk.bigEnums.length) add('big-enum', 'low', `Enum with more than ${LIMITS.enumSize} values at ${walk.bigEnums[0]}; consider free text with validation.`);

    return { name: t.name, tokens, params: walk.params, issues, style: styleOf(t.name), description: desc };
  });

  // near-duplicate tools: report on the later one, pointing at the earlier
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < i; j++) {
      const sameName = rows[i].name === rows[j].name;
      const sim = similarity(`${rows[i].name} ${rows[i].description}`, `${rows[j].name} ${rows[j].description}`);
      if (sameName || sim >= 0.6) {
        rows[i].issues.push({ code: 'near-duplicate', severity: 'high', message: `${sameName ? 'Same name as' : `Very similar to (${Math.round(sim * 100)}%)`} "${rows[j].name}"; merge them or make the difference explicit.`, saves: rows[i].tokens.total });
        break;
      }
    }
  }

  // naming consistency: flag tools not using the majority style
  const counts = {};
  for (const r of rows) if (r.style !== 'single-word') counts[r.style] = (counts[r.style] ?? 0) + 1;
  const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (Object.keys(counts).length > 1) {
    for (const r of rows) if (r.style !== 'single-word' && r.style !== majority) r.issues.push({ code: 'naming-style', severity: 'low', message: `Uses ${r.style}; most tools use ${majority}.`, saves: 0 });
  }

  const totalTokens = rows.reduce((n, r) => n + r.tokens.total, 0);
  const weight = { high: 10, medium: 5, low: 2 };
  const penalty = rows.flatMap((r) => r.issues).reduce((n, i) => n + weight[i.severity], 0);
  const issueCounts = { high: 0, medium: 0, low: 0 };
  rows.forEach((r) => r.issues.forEach((i) => issueCounts[i.severity]++));
  rows.sort((a, b) => b.tokens.total - a.tokens.total);

  return {
    toolCount: rows.length,
    totalTokens,
    budget: limit,
    overBudget: totalTokens > limit,
    pctOfBudget: Math.round((totalTokens / limit) * 1000) / 10,
    potentialSavings: rows.reduce((n, r) => n + r.issues.reduce((m, i) => m + Math.max(0, i.saves), 0), 0),
    health: Math.max(0, Math.round(100 - penalty / Math.max(1, rows.length) * 4)),
    issueCounts,
    tokenEstimate: 'characters / 4 (approximate)',
    tools: rows,
  };
}