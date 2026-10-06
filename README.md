# MCP Context Budget Linter

> **Agent-generated prototype.** Built automatically by a daily-product agent on 2026-10-06. Not reviewed line-by-line; read the code before relying on it.

Paste or upload an MCP server's tools/list JSON and see approximately how many context tokens each tool definition costs. It flags missing or vague descriptions, bloated schemas, undocumented parameters, near-duplicate tools and inconsistent naming, and suggests shorter rewrites using rules. Everything runs locally and the analysis is deterministic.

## Features
- Accepts a tools array, an object with tools, or a raw JSON-RPC tools/list response
- Approximate token cost per tool split into name, description and schema, sorted by cost
- Configurable token budget with over/under indicator and share-of-budget figure
- Issue detection: missing/vague/oversized descriptions, undocumented parameters, oversized or deeply nested schemas, near-duplicate tools, mixed naming styles
- Rule-based rewrite suggestion per tool; optional LLM rewrite when an AI provider is configured (falls back to rules)
- Health score and estimated token savings
- Recent analyses summary kept in a local JSON file
- Bundled sample MCP tool list for zero-setup demo

## Run
```bash
npm install
npm start        # http://localhost:3000 (PORT to change). Mock mode when no credentials are set.
npm run lint
npm test         # smoke test
```

## Configuration
| Variable | Purpose |
|---|---|
| `HOST` | Bind address (default 127.0.0.1) |
| `DB_FILE` | Path of the JSON file storing recent analyses (default ./db.json, gitignored) |
| `ANTHROPIC_API_KEY` | Optional: enables Anthropic rewrites when AI_PROVIDER=anthropic |
| `OPENAI_API_KEY` | Optional: enables OpenAI rewrites when AI_PROVIDER=openai |
| `OLLAMA_HOST` | Optional: Ollama base URL (default http://localhost:11434) |
| `OLLAMA_MODEL` | Optional: Ollama model name |

Copy `.env.example` to `.env` and fill in only what you need. With nothing set the app runs in mock mode.

Choices made for this build: auth=`none`, AI provider default=`rules` (auto-falls back to rules), data store=`json`, deploy=`github-only`.

## What was tested
- Syntax lint of all JS files and a smoke test that starts the server in **mock mode with no credentials** and checks these routes return the expected status: `GET /health`, `GET /`, `GET /api/sample`, `GET /api/history`, `POST /api/analyze`, `POST /api/suggest`.
- Mock behavior: The app has no external services. Mock mode means the bundled fixtures/sample-tools.json is the default input and AI_PROVIDER resolves to the built-in rules provider (forced when MOCK_MODE=1). Remote AI providers were never called.

## Not tested
- Anything outside mock mode: the automated checks ran with no credentials and no live services.
- Remote AI providers (anthropic / openai / ollama) via `ai-provider.js`: not exercised, only the `rules` fallback was.
- Security hardening, load, and browser UI beyond HTTP status checks.

## Limitations
- Token counts are estimated as characters divided by 4; real tokenizers differ by model, so treat numbers as relative, not exact
- Rules are heuristics: vague-description and duplicate detection will produce false positives and misses
- Does not connect to live MCP servers; it analyses JSON you paste or upload
- No authentication; intended to run locally on 127.0.0.1
- Remote AI rewrite is untested; only the built-in rules provider was exercised

## Origin
Idea: Every MCP tool definition is paid for in context tokens on every call; vague, overlapping or bloated tool descriptions silently degrade agent accuracy and cost.
Why now: MCP SDKs are shipping v2.x and research is now mapping the MCP tool landscape and how execution context accumulates for agents.
Signals:
- https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1
- http://arxiv.org/abs/2610.05319v1
- http://arxiv.org/abs/2609.37743v1
