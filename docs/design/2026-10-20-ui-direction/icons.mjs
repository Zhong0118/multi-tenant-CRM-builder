import fs from 'node:fs';

const cache = {};
function load(set) {
  cache[set] ??= JSON.parse(fs.readFileSync(new URL(`./icons/${set}.json`, import.meta.url), 'utf8'));
  return cache[set];
}

// Inline SVG for a semantic key ("customers") from one Iconify set.
// Stroke sets get a lighter stroke so they sit at the weight of 14px body text.
const STROKE = { tabler: '1.5', lucide: '1.75' };

export function icon(set, key, size = 16, cls = '') {
  const data = load(set);
  const name = data.map[key];
  if (!name) throw new Error(`icon key "${key}" is not mapped for ${set}`);
  let def = data.icons[name];
  if (!def && data.aliases?.[name]) def = data.icons[data.aliases[name].parent];
  if (!def) throw new Error(`icon "${name}" missing from ${set}.json`);
  const w = def.width ?? data.width ?? 24;
  const h = def.height ?? data.height ?? 24;
  let body = def.body;
  if (STROKE[set]) body = body.replace(/stroke-width="[\d.]+"/g, `stroke-width="${STROKE[set]}"`);
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 ${w} ${h}" fill="currentColor" aria-hidden="true">${body}</svg>`;
}

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function page({ title, css, body }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=1440">
<link rel="stylesheet" href="${css}">
</head>
<body>
${body}
</body>
</html>
`;
}
