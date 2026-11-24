const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { runtime, web, tenant } = require('./runtime.cjs');
const { readImportFile } = web('record-import-file');
const {
  emptyAssistDraft,
  draftForImportHeader,
  buildImportHeaderEvidence,
  buildImportPreview,
  applyImportAdvice,
  reviewImportPlan,
  aiImportableField,
} = web('record-import-assist');
const { OWNER } = web('record-import-mapping');
const { targetKey, score, business, bulkReviewed } = require('./score.cjs');
const { observedProvider } = require('./provider.cjs');
const fixture = path.join(__dirname, 'fixtures');
const root = path.resolve(__dirname, '../../../../..');
const { reports } = require('./revision.cjs');
const read = (file) => JSON.parse(fs.readFileSync(path.join(fixture, file)));
const sha = (content) => createHash('sha256').update(content).digest('hex');
const [split, mode, profile] = process.argv.slice(2);
const supplemental = profile === 'employee-supplement';
assert(
  profile === undefined ||
    (supplemental && split === 'development' && mode !== 'rules'),
);
assert(
  ['development', 'holdout', 'fresh', 'final'].includes(split) &&
    ['rules', 'none'].includes(mode),
);
function initial(parsed, fields, admin, columns) {
  const draft = emptyAssistDraft(parsed?.headers ?? [], fields, admin);
  for (const [i, c] of columns.entries()) {
    if (c.localOnly === 'manualOwner' && admin) {
      draft.mapping[i] = OWNER;
      draft.manual.push(i);
    }
    if (c.locked === true) {
      draft.mapping[i] = targetKey(c.target);
      draft.manual.push(i);
    }
  }
  return draft;
}
function parse(file, sheet, row) {
  try {
    return file.sheet(sheet, row);
  } catch {
    return null;
  }
}
async function authorization(h, request, obj) {
  const actor = h.actors.REP_A,
    before = await h.snapshot();
  let calls = 0;
  const service = h.assist({
    generateImportAssist: async () => {
      calls++;
      throw Error('denied call reached provider');
    },
  });
  async function denied() {
    try {
      await service.preview(
        actor,
        obj.code,
        request,
        new AbortController().signal,
      );
      return 200;
    } catch (e) {
      return e.getStatus?.() ?? 500;
    }
  }
  const p = await h.db.objectPermission.create({
    data: {
      tenantId: actor.tenantId,
      objectId: obj.id,
      subjectType: 'MEMBER',
      subjectMemberId: actor.memberId,
      canRead: true,
      canCreate: true,
      canImport: false,
      canUpdate: true,
      canDelete: false,
      readScope: 'ALL',
      updateScope: 'OWN',
    },
  });
  let canImport, entitled;
  try {
    canImport = await denied();
  } finally {
    await h.db.objectPermission.delete({ where: { id: p.id } });
  }
  await h.db.aiPlan.update({
    where: { id: h.plan.id },
    data: { features: [] },
  });
  try {
    entitled = await denied();
  } finally {
    await h.db.aiPlan.update({
      where: { id: h.plan.id },
      data: { features: ['import_assist'] },
    });
  }
  assert.deepEqual(await h.snapshot(), before);
  return {
    canImport,
    entitled,
    calls,
    pass: canImport === 403 && entitled === 403 && calls === 0,
  };
}

async function run(h, entry, protectedCells) {
  const answer = read(entry.answer),
    admin = !supplemental && answer.profile === 'admin';
  const actor = admin ? h.actors.SELF : h.actors.REP_A;
  const obj = await h.object(answer.requiredOverrides, split === 'final');
  const resolved = await h.schema.resolveRuntimeSchema(actor, obj.code);
  const { fields, queryFieldKeys } = resolved.visibleSchema;
  if (split === 'final') {
    const available = new Set(resolved.schema.fields.map((f) => f.fieldKey));
    for (const c of answer.columns)
      if (c.target.field) assert(available.has(c.target.field));
  }
  const before = await h.snapshot();
  const start = performance.now();
  const file = await readImportFile(
    new File(
      [fs.readFileSync(path.join(fixture, entry.source))],
      path.basename(entry.source),
    ),
    'auto',
  );
  const sheet = answer.sheetName ?? '';
  const selection = file.headerSelection(
    sheet,
    fields.filter(aiImportableField),
  );
  const header = selection.headerRow;
  const parsed = parse(file, sheet, header);
  const draft = initial(parsed, fields, admin, answer.columns);
  const excluded = answer.columns.flatMap((c, i) =>
    c.localOnly === 'userExcluded' ? [i] : [],
  );
  const preview = buildImportPreview({
    headerEvidence: await buildImportHeaderEvidence(file, sheet),
    file,
    sheet,
    headerRow: header,
    headerLocked: selection.detected,
    fields,
    draft,
    excluded,
    admin,
  });
  const log = {
    id: entry.id,
    source: entry.source,
    scenario: answer.scenario,
    actor: actor.role,
    columns: answer.columns.length,
    rowCount: answer.rows.length,
    entries: 0,
    calls: 0,
    privacy: [],
    wireScanned: false,
    modelForbiddenTargets: 0,
    inputTokens: null,
    outputTokens: null,
    modelMs: null,
    error: null,
  };
  let plan;
  if (mode !== 'rules' && preview.needed) {
    const service = h.assist(
      observedProvider(mode, answer, resolved, h, log, protectedCells),
    );
    try {
      const response = await service.preview(
        actor,
        obj.code,
        preview.request,
        new AbortController().signal,
      );
      plan = reviewImportPlan(
        response,
        preview,
        file,
        sheet,
        fields,
        tenant.timeZone,
      );
    } catch (e) {
      log.error = log.privacy.length
        ? 'privacyGate'
        : (log.error ?? e.code ?? e.getStatus?.() ?? 'serviceError');
    }
  }
  const alternate = plan && header !== plan.headerRow;
  const candidateHeader = plan?.headerRow ?? header;
  const candidateParsed = alternate
    ? parse(file, sheet, candidateHeader)
    : parsed;
  const candidateBase = alternate
    ? draftForImportHeader(candidateParsed?.headers ?? [], fields, admin, draft)
    : draft;
  const apply = (base, choice) =>
    applyImportAdvice(base, preview, plan, fields, choice, queryFieldKeys);
  const auto = plan && !alternate ? apply(draft) : draft;
  log.endToEndMs = Math.round(performance.now() - start);
  log.planReturned = Boolean(plan);
  log.zeroCallPassed = answer.providerCalls !== 0 || log.entries === 0;
  log.candidate = score(
    answer,
    candidateHeader,
    candidateBase,
    fields,
    plan,
    preview,
  );
  log.auto = score(answer, header, auto, fields);
  log.autoBusiness = await business(
    h,
    actor,
    obj,
    parsed,
    auto,
    fields,
    answer,
  );
  let reviewed = auto,
    reviewParsed = parsed,
    reviewHeader = header;
  // Only this explicitly simulated human sees the key. Never complete absent predictions.
  if (plan && candidateHeader === answer.headerRow) {
    if (alternate) {
      reviewed = apply(candidateBase);
      reviewParsed = candidateParsed;
      reviewHeader = candidateHeader;
    }
    for (const col of plan.columns) {
      const c = answer.columns.find((c) => c.col === col.col);
      if (!c || targetKey(col.target) !== targetKey(c.target)) continue;
      if (
        col.confidence === 'review' &&
        (!col.dateOrder || col.dateOrder === c.dateOrder) &&
        (!col.bareAmountUnit || col.bareAmountUnit === c.bareAmountUnit)
      )
        reviewed = apply(reviewed, { column: col.col });
      for (const v of col.values ?? []) {
        const raw = preview.bindings.get(
          candidateHeader + ':' + col.col + ':' + v.value,
        );
        if (
          v.confidence === 'review' &&
          c.values?.some((t) => t.raw === raw && t.option === v.option)
        )
          reviewed = apply(reviewed, { column: col.col, value: v.value });
      }
    }
  }
  if (split === 'development')
    log.highConfidence = (plan?.columns ?? [])
      .filter((c) => c.confidence === 'high')
      .map((c) => {
        const expected = answer.columns.find((a) => a.col === c.col);
        return {
          col: c.col,
          headerRow: candidateHeader,
          target: c.target,
          correct:
            candidateHeader === answer.headerRow &&
            expected &&
            targetKey(c.target) === targetKey(expected.target),
        };
      });
  log.review = score(answer, reviewHeader, reviewed, fields);
  log.reviewBusiness =
    mode === 'rules'
      ? log.autoBusiness
      : await business(h, actor, obj, reviewParsed, reviewed, fields, answer);
  const bulk = bulkReviewed(
    reviewed,
    reviewParsed,
    reviewHeader,
    fields,
    answer,
  );
  log.bulkColumns = Object.keys(bulk.valueChoices)
    .filter((i) => bulk.valueChoices[i] !== reviewed.valueChoices[i])
    .map((i) => 'C' + (+i + 1));
  log.bulkBusiness = log.bulkColumns.length
    ? await business(h, actor, obj, reviewParsed, bulk, fields, answer)
    : log.reviewBusiness;
  if (answer.pair) {
    log.pair = answer.pair;
    const predictions = (plan?.columns ?? [])
      .map((c) => [
        c.col,
        c.target,
        c.values
          ?.map((v) => [
            preview.bindings.get(candidateHeader + ':' + c.col + ':' + v.value),
            v.option,
          ])
          .sort() ?? [],
      ])
      .sort();
    log.outputDigest = sha(
      JSON.stringify([
        candidateHeader,
        predictions,
        auto.mapping,
        Object.entries(auto.valueChoices).map(([k, v]) => [k, [...v].sort()]),
      ]),
    );
  }
  assert.deepEqual(
    await h.snapshot(),
    before,
    'preview or import changed the business snapshot',
  );
  log.authorization = await authorization(h, preview.request, obj);
  return log;
}
// Identify protected text by the sole changed physical cell in each frozen pair.
// These values stay local and are checked against every actual outgoing request.
async function protectedWorkbookCells() {
  const cells = [];
  for (const filename of [
    'manifest.json',
    'fresh/manifest.json',
    'final/manifest.json',
  ]) {
    const pairs = new Map();
    for (const entry of read(filename).files) {
      const a = read(entry.answer);
      if (!a.pair) continue;
      const group = pairs.get(a.pair) ?? {};
      const bytes = fs.readFileSync(path.join(fixture, entry.source));
      const file = await readImportFile(
        new File([bytes], path.basename(entry.source)),
        'auto',
      );
      group[a.variant] = file.sheet(a.sheetName ?? '', a.headerRow).rows;
      pairs.set(a.pair, group);
    }
    for (const { control, injected } of pairs.values()) {
      assert.equal(control.length, injected.length);
      const diff = injected.flatMap((row, i) => {
        assert.equal(control[i].length, row.length);
        return row.filter((v, j) => v !== control[i][j]);
      });
      assert.equal(diff.length, 1);
      assert(diff[0]?.trim());
      cells.push(diff[0]);
    }
  }
  assert.equal(cells.length, 4);
  return cells;
}
async function main() {
  const { revision } = require('./revision.cjs');
  const fingerprint = revision();
  console.log('implementation', fingerprint);
  if (split !== 'development') {
    const freeze = JSON.parse(
      fs.readFileSync(path.join(reports, 'eval-freeze.json')),
    );
    assert.equal(
      fingerprint,
      freeze.fingerprint,
      'implementation changed after development freeze',
    );
  }
  require('node:child_process').execFileSync(
    process.execPath,
    [path.join(fixture, 'verify.cjs')],
    { cwd: root },
  );
  const separate = ['fresh', 'final'].includes(split);
  const manifest = separate ? split + '/manifest.json' : 'manifest.json';
  const checksums = separate ? split + '/SHA256SUMS' : 'SHA256SUMS';
  // Verify the manifest of checksums against its independently frozen Git object.
  const fixtureCommit =
    split === 'final'
      ? 'a4f8d9a'
      : split === 'fresh'
        ? '49217f9a5dcbcd01b99f83593a138c274a5cf17d'
        : 'f808ea8';
  const frozen = require('node:child_process').execFileSync(
    'git',
    [
      'show',
      fixtureCommit + ':' + path.relative(root, path.join(fixture, checksums)),
    ],
    { cwd: root },
  );
  assert.deepEqual(fs.readFileSync(path.join(fixture, checksums)), frozen);
  if (separate)
    for (const line of frozen.toString().trimEnd().split('\n')) {
      const [digest, name] = line.split('  ');
      assert.equal(
        sha(fs.readFileSync(path.join(fixture, name))),
        digest,
        name,
      );
    }
  const files = read(manifest).files.filter((f) => f.split === split);
  const resultName =
    'eval-' +
    (supplemental ? 'employee-supplement-' : '') +
    split +
    '-' +
    mode +
    '.json';
  const output = path.join(reports, resultName);
  assert(!fs.existsSync(output), 'this round already has ' + resultName);

  const protectedCells = await protectedWorkbookCells();
  const h = await runtime(),
    results = [];
  const sends = [];
  async function measured(entry) {
    while (sends.length && sends[0] <= Date.now() - 60000) sends.shift();
    if (sends.length >= 12)
      await require('node:timers/promises').setTimeout(
        Math.max(1, 60001 + sends.shift() - Date.now()),
      );
    const log = await run(h, entry, protectedCells);
    if (log.calls) sends.push(Date.now());
    return log;
  }
  try {
    for (const entry of files) {
      const log = await measured(entry);
      if (log.pair && mode !== 'rules') {
        log.repeats = [];
        for (let i = 0; i < 2; i++) {
          const repeat = await measured(entry);
          const keys = [
            'entries',
            'calls',
            'error',
            'modelMs',
            'endToEndMs',
            'privacy',
            'wireScanned',
            'wireDigest',
            'modelInputDigest',
            'modelOutputDigest',
            'outputDigest',
            'zeroCallPassed',
            'modelForbiddenTargets',
            'inputTokens',
            'outputTokens',
            'authorization',
          ];
          log.repeats.push(
            Object.fromEntries(
              keys.filter((k) => k in repeat).map((k) => [k, repeat[k]]),
            ),
          );
        }
      }
      results.push(log);
      console.log(
        entry.id,
        log.entries,
        log.calls,
        log.error ?? 'ok',
        log.modelMs,
        log.inputTokens,
        log.outputTokens,
      );
    }
  } finally {
    await h.close();
  }
  assert.equal(results.length, split === 'development' ? 30 : 10);
  const size = {
    development: [30, 164, 449],
    holdout: [10, 107, 102],
    fresh: [10, 116, 132],
    final: [10, 123, 103],
  }[split];
  const sum = (k) => results.reduce((n, r) => n + r[k], 0);
  assert.deepEqual([results.length, sum('columns'), sum('rowCount')], size);
  fs.mkdirSync(reports, { recursive: true });
  const metadata = {
    split,
    mode,
    profile: supplemental ? 'employee supplement' : 'frozen',
    fingerprint,
    model: mode === 'rules' ? null : process.env.AI_MODEL,
    fixtureCommit,
    manifestHash: sha(frozen),
    protectedWorkbookPairs: protectedCells.length,
    files: results,
  };
  fs.writeFileSync(output, JSON.stringify(metadata, null, 2) + '\n', {
    flag: 'wx',
  });
}
main().catch((e) => {
  console.error(e.stack?.split('\n').slice(0, 10).join('\n'));
  process.exitCode = 1;
});
