// Minimal JSON file store. Path comes from DB_FILE (default ./db.json, which is gitignored). (agent-generated)
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';

const file = () => process.env.DB_FILE || './db.json';

export function load(fallback = {}) {
  return existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : structuredClone(fallback);
}
export function save(data) {
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file());
}
