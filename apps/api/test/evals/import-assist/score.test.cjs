const test = require('node:test');
const assert = require('node:assert/strict');
const { compareReady, addedWrongValues, gates } = require('./metrics.cjs');

test('READY classifies a missing field and nonempty wrong/extra fields independently', () => {
  const expected = {
    name: 'X',
    budget: '12.30',
    tags: ['x', 'y'],
    nullable: null,
    flags: false,
  };
  const actual = {
    budget: 12.3,
    tags: ['y', 'x'],
    flags: false,
    extra: 0,
    blank: [],
    nullable: 'unexpected',
  };
  const diff = compareReady(expected, actual, new Map([['budget', 'MONEY']]));
  assert.deepEqual(diff.missing, ['name']);
  assert.deepEqual(
    diff.wrong.map((d) => [d.field, d.reason]),
    [
      ['tags', 'different'],
      ['nullable', 'unexpected'],
      ['extra', 'unexpected'],
    ],
  );
  assert.ok(!JSON.stringify(diff).includes('"y"'));
  assert.deepEqual(compareReady({ blank: null }, {}, new Map()), {
    missing: [],
    wrong: [],
  });
});

test('additional wrong values compare by original row, field and normalized value', () => {
  const before = [
    { rowNumber: 3, field: 'x', digest: 'a' },
    { rowNumber: 5, field: 'x', digest: 'b' },
  ];
  const after = [
    before[0],
    { rowNumber: 5, field: 'x', digest: 'c' },
    { rowNumber: 4, field: 'x', digest: 'a' },
  ];
  assert.deepEqual(addedWrongValues(before, after), after.slice(1));
});

test('gates include timed out physical sends, both wide files and the oracle READY denominator', () => {
  const file = {
    columns: 40,
    entries: 1,
    calls: 1,
    modelMs: 1000,
    endToEndMs: 1010,
    pair: 'pair',
    wireScanned: true,
    wireDigest: 'wire',
    outputDigest: 'o',
    modelInputDigest: 'i',
    modelOutputDigest: 'm',
    zeroCallPassed: true,
    authorization: { pass: true },
    privacy: [],
    modelForbiddenTargets: 0,
    candidate: {
      cols: 10,
      needed: 5,
      matched: 4,
      wrong: 0,
      high: 2,
      highWrong: 0,
      forbiddenTargets: 0,
    },
    auto: { forbiddenTargets: 0 },
    review: { forbiddenTargets: 0 },
    autoBusiness: { noWrites: true },
    bulkBusiness: { noWrites: true },
    reviewBusiness: { expectedReady: 5, matchedReady: 4, noWrites: true },
  };
  file.repeats = Array.from({ length: 2 }, () => ({ ...file }));
  assert.equal(Object.values(gates([file, file])).every(Boolean), true);
  const changed = {
    ...file,
    error: 'timeout',
    modelMs: 45000,
    endToEndMs: 45010,
    candidate: { ...file.candidate, matched: 3 },
    reviewBusiness: { ...file.reviewBusiness, matchedReady: 0 },
  };
  const failed = gates([file, changed]);
  for (const key of ['coverage', 'ready', 'wideReady', 'latency'])
    assert.equal(failed[key], false, key);
  assert.equal(gates([file, { ...file, modelMs: null }]).latency, false);
});

test('offline report distinguishes overlapping rows and fields and attributes new wrong values', (t) => {
  const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'import-report-'));
  t.after(() => fs.rmSync(reports, { recursive: true, force: true }));
  const preload = path.join(reports, 'reports.cjs');
  fs.writeFileSync(
    preload,
    'require(' +
      JSON.stringify(require.resolve('./revision.cjs')) +
      ').reports = ' +
      JSON.stringify(reports),
  );
  const candidate = {
    wrong: 0,
    cols: 40,
    highWrong: 0,
    high: 1,
    matched: 8,
    needed: 10,
    correctValues: 0,
    values: 0,
    header: 1,
    forbiddenTargets: 0,
  };
  for (const mode of ['rules', 'default', 'none']) {
    const wrongDetails =
      mode === 'rules'
        ? []
        : [
            {
              field: 'budget',
              rowNumber: 4,
              digest: 'number-hash',
              reason: 'different',
              type: 'MONEY',
              sources: ['C3'],
              expectedSources: ['C2'],
            },
          ];
    const biz = {
      rows: 5,
      ready: 4,
      matchedReady: 4,
      expectedReady: 5,
      readyWithoutValueLabels: 0,
      conversionFailed: 1,
      serverFailed: 0,
      unprocessed: 0,
      existingDuplicate: 0,
      fileDuplicate: 0,
      ownerSkip: 0,
      unexpectedRows: 0,
      readyValuesMismatch: 1,
      missingFields: 1,
      missingRows: 1,
      wrongFields: wrongDetails.length,
      wrongRows: wrongDetails.length,
      wrongDetails,
      missedReadyReasons: {},
      noWrites: true,
    };
    const files = ['left', 'right'].map((id) => ({
      id,
      actor: 'A',
      rowCount: 5,
      columns: 40,
      entries: 1,
      calls: 1,
      error: null,
      modelMs: 2,
      endToEndMs: 3,
      privacy: [],
      modelForbiddenTargets: 0,
      zeroCallPassed: true,
      pair: 'P',
      outputDigest: 'abc',
      modelInputDigest: 'x',
      modelOutputDigest: 'y',
      candidate: { ...candidate, mismatches: [] },
      auto: candidate,
      review: candidate,
      autoBusiness: biz,
      reviewBusiness: biz,
      bulkBusiness: biz,
      wireScanned: true,
      wireDigest: 'wire',
      authorization: { pass: true, canImport: 403, entitled: 403, calls: 0 },
    }));
    for (const f of files)
      f.repeats = Array.from({ length: 2 }, () => ({ ...f }));
    fs.writeFileSync(
      path.join(reports, 'eval-development-' + mode + '.json'),
      JSON.stringify({
        fingerprint: 'same',
        fixtureCommit: 'test',
        manifestHash: 'test',
        mode,
        files,
      }),
    );
  }
  execFileSync(process.execPath, [
    '-r',
    preload,
    require.resolve('./report.cjs'),
    'development',
  ]);
  const md = fs.readFileSync(path.join(reports, 'eval-development.md'), 'utf8');
  assert.match(md, /\| none \| 人工采用 \| left \| 4 \| budget \| .*C3.*C2/);
  assert.match(
    md,
    /\| none \| 人工采用 \| 8\/8 \(100.0%\) \| 2 \| 2 \| 2 \| 2 \| 2 \|/,
  );
  assert.match(md, /新增错值为零/);
  assert.match(md, /\| none (?:\| 通过 ){11}\| 未通过 \| 否 \|/);
  assert.doesNotMatch(md, /number-hash|undefined|NaN/);
});
