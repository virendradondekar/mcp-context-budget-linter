// All untrusted text (tool names/descriptions) is inserted with textContent, never innerHTML.
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};

function showError(msg) { $('error').textContent = msg ?? ''; $('error').hidden = !msg; }

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

function stat(label, value, cls = '') { return el('div', { className: 'stat' }, el('span', { className: 'muted', textContent: label }), el('b', { className: cls, textContent: value })); }

function render(result, rawTools) {
  $('results').hidden = false;
  const s = $('summary');
  s.replaceChildren(
    stat('Estimated tokens', result.totalTokens.toLocaleString(), result.overBudget ? 'over' : ''),
    stat('Budget used', `${result.pctOfBudget}% of ${result.budget.toLocaleString()}`, result.overBudget ? 'over' : ''),
    stat('Tools', String(result.toolCount)),
    stat('Health score', `${result.health}/100`),
    stat('Issues', `${result.issueCounts.high} high · ${result.issueCounts.medium} med · ${result.issueCounts.low} low`),
    stat('Possible savings', `~${result.potentialSavings.toLocaleString()} tokens`),
  );
  const max = Math.max(...result.tools.map((t) => t.tokens.total), 1);
  const rows = $('rows');
  rows.replaceChildren();
  for (const t of result.tools) {
    const bar = el('div', { className: 'bar' });
    bar.style.width = `${Math.round((t.tokens.total / max) * 100)}%`;
    const issues = el('td');
    if (!t.issues.length) issues.append(el('span', { className: 'muted', textContent: 'No issues found' }));
    for (const i of t.issues) issues.append(el('p', { className: `issue sev-${i.severity}`, textContent: `[${i.severity}] ${i.message}` }));
    const sugg = el('div');
    const btn = el('button', { className: 'secondary', type: 'button', textContent: 'Suggest rewrite' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const orig = rawTools.find((x) => x.name === t.name) ?? { name: t.name, description: t.description };
        const r = await api('/api/suggest', { tool: { name: orig.name, description: orig.description } });
        sugg.replaceChildren(el('div', { className: 'suggestion', textContent: `${r.description}\n\n(${r.provider}) ${(r.notes ?? []).join(' ')}` }));
      } catch (e) { sugg.replaceChildren(el('div', { className: 'error', textContent: e.message })); }
      btn.disabled = false;
    });
    rows.append(el('tr', {},
      el('td', {}, el('b', { textContent: t.name }), el('div', { className: 'muted', textContent: `${t.params} param(s)` })),
      el('td', { textContent: `${t.tokens.total} (n ${t.tokens.name} · d ${t.tokens.description} · s ${t.tokens.schema})` }),
      el('td', {}, bar),
      issues,
      el('td', {}, btn, sugg),
    ));
  }
}

async function loadHistory() {
  try {
    const { history } = await api('/api/history');
    const ul = $('history');
    ul.replaceChildren();
    if (!history.length) ul.append(el('li', { textContent: 'None yet.' }));
    for (const h of history) ul.append(el('li', { textContent: `${new Date(h.at).toLocaleString()} — ${h.toolCount} tools, ~${h.totalTokens} tokens (budget ${h.budget}), health ${h.health}` }));
  } catch { /* history is optional */ }
}

async function analyzeNow() {
  showError('');
  try {
    const parsed = JSON.parse($('input').value);
    const result = await api('/api/analyze', { tools: parsed, budget: Number($('budget').value) });
    const raw = Array.isArray(parsed) ? parsed : parsed.tools ?? parsed.result?.tools ?? [];
    render(result, raw);
    loadHistory();
  } catch (e) { showError(e instanceof SyntaxError ? 'Input is not valid JSON.' : e.message); }
}

$('analyze').addEventListener('click', analyzeNow);
$('sample').addEventListener('click', async () => {
  try { $('input').value = JSON.stringify(await api('/api/sample'), null, 2); analyzeNow(); } catch (e) { showError(e.message); }
});
$('file').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  if (f) { $('input').value = await f.text(); analyzeNow(); }
});
loadHistory();