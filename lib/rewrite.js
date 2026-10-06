// Deterministic, rule-based description suggestions (the `rules` AI provider).

const humanize = (name) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();

function firstSentences(text, maxChars) {
  const parts = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  let out = '';
  for (const p of parts) {
    if ((out + p).length > maxChars && out) break;
    out += p;
  }
  return (out || text).slice(0, maxChars).trim();
}

export function suggestRewrite(tool) {
  const name = String(tool?.name ?? 'tool');
  const desc = String(tool?.description ?? '').replace(/\s+/g, ' ').trim();
  const notes = [];
  let description;
  if (!desc) {
    description = `${humanize(name)[0]?.toUpperCase() ?? ''}${humanize(name).slice(1)}. Use when <describe the situation>. Returns <describe the result>.`;
    notes.push('Template only: replace the <placeholders> with facts about what this tool really does.');
  } else if (desc.length > 300) {
    description = firstSentences(desc, 300);
    notes.push(`Trimmed from ${desc.length} to ${description.length} characters; move long usage notes to documentation.`);
  } else if (desc.length < 40) {
    description = `${desc.replace(/[.!?]+$/, '')}. Use when <describe the situation>. Returns <describe the result>.`;
    notes.push('Short description extended with a template; fill in the placeholders.');
  } else {
    description = desc;
    notes.push('Description length looks reasonable; no rewrite needed.');
  }
  return { description, notes };
}