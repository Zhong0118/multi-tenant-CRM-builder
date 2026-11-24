const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../../..');
const reports =
  process.env.IMPORT_EVAL_OUTPUT ??
  path.join(root, 'docs/audits/2026-11-25/ai-import-assist');
const folders = [
  'apps/api/src/modules/ai',
  'apps/api/src/modules/objects',
  'apps/api/src/modules/records',
  'apps/web/src/features/records',
  'apps/api/test/evals/import-assist',
  'apps/web/src/lib/csv.ts',
  'packages/contracts/src/ai',
  'packages/contracts/package.json',
  'packages/database/prisma/schema.prisma',
];
function revision() {
  const hash = createHash('sha256');
  const files = execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      ...folders,
    ],
    { cwd: root, maxBuffer: 8 * 1024 * 1024 },
  )
    .toString()
    .split('\0')
    .filter(Boolean)
    .filter((f) => !/(\.spec\.|\.test\.|\/fixtures\/)/.test(f))
    .filter((f) => !f.endsWith('/report.cjs') && !f.endsWith('.md'))
    .sort();
  for (const f of files)
    hash
      .update(f)
      .update('\0')
      .update(fs.readFileSync(path.join(root, f)))
      .update('\0');
  return hash.digest('hex');
}
module.exports = { revision, root, reports };
