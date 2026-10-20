// Generates the static candidate pages. Each direction has its own render module with its own
// markup; they only share the scenario in data.mjs.
import fs from 'node:fs';
import * as A from './a.mjs';

const out = (name, html) => fs.writeFileSync(new URL(`./${name}`, import.meta.url), html);
const only = process.argv[2];

const dirs = { a: A };
try { dirs.b = await import('./b.mjs'); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
try { dirs.d = await import('./d.mjs'); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
try { dirs.c = await import('./c.mjs'); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }

for (const [id, mod] of Object.entries(dirs)) {
  if (only && only !== id) continue;
  for (const screen of ['list', 'drawer', 'config']) out(`${id}-${screen}.html`, mod[screen]());
  console.log('built', id);
}
