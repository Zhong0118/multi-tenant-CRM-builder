// Run directly with Node after installing the workspace's regular dependencies.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const { join, extname } = require('node:path');
const XLSX = require(require.resolve('xlsx', { paths: [join(__dirname, '../../../../../web')] }));

const read = name => readFileSync(join(__dirname, name));
const json = name => JSON.parse(read(name));
const { files } = json('manifest.json');
const tenant = json('tenant.json');
const fields = new Map(tenant.fields.map(field => [field.fieldKey, field]));
const hashes = new Map(read('SHA256SUMS').toString().trimEnd().split('\n').map(line => {
  const [hash, name] = line.split('  ');
  return [name, hash];
}));
const inventory = ['tenant.json', 'manifest.json', ...files.flatMap(f => [f.source, f.answer])];
assert.deepEqual([...hashes.keys()].sort(), inventory.sort());
for (const [file, hash] of hashes)
  assert.equal(createHash('sha256').update(read(file)).digest('hex'), hash, file);
assert.equal(new Set(files.map(f => f.id)).size, files.length);

for (const [split, count] of [['development', 30], ['holdout', 10]]) {
  const group = files.filter(f => f.split === split);
  assert.equal(group.length, count);
  const formats = new Set(group.map(f => extname(f.source)));
  assert.deepEqual(formats, new Set(['.csv', '.xls', '.xlsx']));
  const entries = group.flatMap(f => [f.source, f.answer]);
  assert.deepEqual(readdirSync(join(__dirname, split)).map(name => split + '/' + name).sort(), entries.sort());
  const answers = group.map(f => json(f.answer));
  assert.ok(answers.filter(a => a.columns.length === 40).length >= 2);
  assert.ok(answers.some(a => a.headerRow === 3 && a.providerCalls === 0));
  assert.ok(answers.some(a => a.profile === 'employee'));
  assert.ok(answers.some(a => a.columns.some(c => c.localOnly === 'manualOwner')));
  const kinds = new Set(answers.flatMap(a => a.forbidden.map(s => s.kind)));
  for (const kind of ['mobile', 'landline', 'email', 'nationalId', 'bank', 'ownerCell',
    'restrictedCell', 'restrictedHeader', 'freeText', 'sheetEmail', 'optionEmail', 'distinctValueEmail'])
    assert.ok(kinds.has(kind), split + '/' + kind);

  const control = answers.find(a => a.variant === 'control');
  const attack = answers.find(a => a.variant === 'injected');
  assert.equal(control.pair, attack.pair);
  assert.deepEqual(control.columns, attack.columns);
  assert.deepEqual(control.rows.map(({ cells, ...r }) => r), attack.rows.map(({ cells, ...r }) => r));
  const changes = control.rows.flatMap((r, i) => r.cells.filter((cell, j) => cell !== attack.rows[i].cells[j]));
  assert.equal(changes.length, 1);
}

for (const entry of files) {
  const a = json(entry.answer);
  try {
    assert.equal(entry.id, a.id);
    assert.equal(a.source, entry.source);
    const bytes = read(a.source);
    const ext = extname(a.source);
    const csv = ext === '.csv';
    const magic = { '.csv': 'efbbbf', '.xls': 'd0cf11e0a1b11ae1', '.xlsx': '504b0304' }[ext];
    assert.equal(bytes.subarray(0, magic.length / 2).toString('hex'), magic);
    const book = XLSX.read(csv ? bytes.toString('utf8').replace(/^\uFEFF/, '') : bytes, {
      type: csv ? 'string' : 'buffer', raw: true, cellNF: true, FS: ',',
    });
    assert.equal(book.SheetNames.length, 1);
    assert.equal(a.sheetName, csv ? null : book.SheetNames[0]);
    const matrix = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {
      header: 1, defval: '', blankrows: true, raw: false, range: 0,
    });
    const width = a.columns.length;
    assert.ok(width > 0 && width <= 40);
    let physical = 1;
    let actualHeaders;
    const actualRows = [];
    for (const cells of matrix) {
      const row = Array.from({ length: width }, (_, i) => cells[i] ?? '');
      assert.ok(cells.slice(width).every(c => c === ''));
      if (physical === a.headerRow) actualHeaders = row;
      if (physical > a.headerRow && row.some(c => c.trim()))
        actualRows.push({ rowNumber: physical, cells: row });
      physical += 1;
      if (csv) physical += row.reduce((n, c) => n + c.split('\n').length - 1, 0);
    }
    assert.deepEqual(actualHeaders, a.columns.map(c => c.header));
    assert.deepEqual(actualRows, a.rows.map(({ rowNumber, cells }) => ({ rowNumber, cells })));
    for (const [i, c] of a.columns.entries()) {
      assert.equal(c.col, 'C' + (i + 1));
      if (c.localOnly) assert.equal(c.target.mode, 'skip');
      if (c.target.mode === 'skip') continue;
      const f = fields.get(c.target.field);
      assert.ok(f && !a.forbiddenTargets.includes(c.target.field));
      if (c.target.mode === 'append') assert.equal(f.type, 'TEXTAREA');
      if (f.options) {
        const tokens = actualRows.flatMap(r => r.cells[i].split(/[;,；，]/).filter(Boolean));
        assert.deepEqual(new Set(tokens), new Set(c.values.map(v => v.raw)));
        assert.equal(c.values.length, new Set(tokens).size);
        for (const v of c.values) assert.ok(v.option === null || f.options.some(o => o.status === 'ACTIVE' && o.key === v.option));
      }
    }
    for (const row of a.rows) {
      assert.ok(['READY', 'FAILED', 'SKIPPED'].includes(row.status));
      assert.equal(row.status === 'READY', row.reason === null);
      if (row.destination.kind === 'member') assert.ok(tenant.members.some(m => m.ref === row.destination.ref));
      if (row.destination.kind === 'skip') assert.equal(row.reason, 'ownerSkip');
    }
    const surfaces = [...matrix.flat(), a.sheetName || '', ...tenant.fields.flatMap(f => f.options?.map(o => o.label) || [])];
    for (const sentinel of a.forbidden)
      assert.ok(surfaces.some(v => String(v).includes(sentinel.value)), sentinel.value);
  } catch (error) {
    throw new Error(entry.source, { cause: error });
  }
}
console.log('Verified 30 development and 10 holdout sources, all 82 SHA-256 digests, physical rows and labels.');
