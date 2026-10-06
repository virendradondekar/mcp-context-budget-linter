// AI provider switch. AI_PROVIDER=rules|anthropic|openai|ollama (default: rules).
// Falls back to the app's own `rules` function when no key/host is configured or a call fails,
// so the app always runs with zero credentials. (agent-generated)

const PROVIDERS = ['rules', 'anthropic', 'openai', 'ollama'];

function resolveProvider(env = process.env) {
  const wanted = (env.AI_PROVIDER || 'rules').toLowerCase();
  if (!PROVIDERS.includes(wanted)) return { provider: 'rules', reason: `unknown AI_PROVIDER "${wanted}"` };
  if (env.MOCK_MODE === '1') return { provider: 'rules', reason: 'MOCK_MODE=1' };
  if (wanted === 'anthropic' && !env.ANTHROPIC_API_KEY) return { provider: 'rules', reason: 'ANTHROPIC_API_KEY not set' };
  if (wanted === 'openai' && !env.OPENAI_API_KEY) return { provider: 'rules', reason: 'OPENAI_API_KEY not set' };
  return { provider: wanted, reason: null };
}

async function post(url, headers, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

const REMOTE = {
  async anthropic({ system, prompt }, env) {
    const j = await post('https://api.anthropic.com/v1/messages',
      { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      { model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 1024, system, messages: [{ role: 'user', content: prompt }] });
    return j.content.map((b) => b.text ?? '').join('');
  },
  async openai({ system, prompt }, env) {
    const j = await post('https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${env.OPENAI_API_KEY}` },
      { model: env.OPENAI_MODEL || 'gpt-4o-mini', messages: [{ role: 'system', content: system ?? '' }, { role: 'user', content: prompt }] });
    return j.choices[0].message.content;
  },
  async ollama({ system, prompt }, env) {
    const j = await post(`${env.OLLAMA_HOST || 'http://localhost:11434'}/api/chat`, {},
      { model: env.OLLAMA_MODEL || 'llama3.2', stream: false, messages: [{ role: 'system', content: system ?? '' }, { role: 'user', content: prompt }] });
    return j.message.content;
  },
};

/**
 * createAI({ rules }) -> { provider, ask({ system, prompt, input }) }
 * `rules(input)` is the app's deterministic fallback and must return a string.
 */
export function createAI({ rules, env = process.env } = {}) {
  if (typeof rules !== 'function') throw new Error('createAI requires a rules(input) fallback');
  const { provider, reason } = resolveProvider(env);
  return {
    provider, fallbackReason: reason,
    async ask({ system, prompt, input }) {
      if (provider === 'rules') return { text: await rules(input ?? prompt), provider: 'rules' };
      try { return { text: await REMOTE[provider]({ system, prompt }, env), provider }; }
      catch (e) { return { text: await rules(input ?? prompt), provider: 'rules', fallbackReason: e.message }; }
    },
  };
}
