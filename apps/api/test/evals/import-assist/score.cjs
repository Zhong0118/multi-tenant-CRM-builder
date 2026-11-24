const { web, tenant } = require('./runtime.cjs');
const { SKIP, APPEND, OWNER, buildImportRows } = web('record-import-mapping');
const { runGroupedImport } = web('record-import-groups');
const { activeOptions } = web('record-import-assist');
const { inferImportDateOrder, matchImportOption } = web('record-csv');
const assert = require('node:assert/strict');
const { compareReady } = require('./metrics.cjs');

const targetKey = (t) =>
  t.mode === 'skip' ? SKIP : (t.mode === 'append' ? APPEND : '') + t.field;
function score(answer, header, draft, fields, plan, preview) {
  const result = {
    cols: answer.columns.length,
    needed: 0,
    matched: 0,
    wrong: 0,
    high: 0,
    highWrong: 0,
    values: 0,
    correctValues: 0,
    forbiddenTargets: 0,
    header: Number(header === answer.headerRow),
  };
  for (const [i, c] of answer.columns.entries()) {
    const expected = targetKey(c.target);
    const suggested = plan?.columns.find((s) => s.col === c.col);
    const actual = suggested ? targetKey(suggested.target) : draft.mapping[i];
    const mapped = actual && actual !== OWNER && actual !== SKIP;
    const correct = header === answer.headerRow && actual === expected;
    const wrong =
      Boolean(mapped && !correct) ||
      Boolean(suggested?.target.mode === 'skip' && expected !== SKIP);
    if (answer.forbiddenTargets.includes(actual?.replace(APPEND, '')))
      result.forbiddenTargets++;
    if (expected !== SKIP) {
      result.needed++;
      if (correct) result.matched++;
    }
    if (wrong) result.wrong++;
    if (suggested?.confidence === 'high') {
      result.high++;
      if (wrong) result.highWrong++;
    }
    for (const truth of c.values ?? []) {
      result.values++;
      if (!correct) continue;
      const opts = activeOptions(fields.find((f) => f.fieldKey === actual));
      const exact = matchImportOption(truth.raw, opts);
      const candidate = suggested?.values?.find(
        (v) =>
          preview.bindings.get(header + ':' + c.col + ':' + v.value) ===
          truth.raw,
      );
      const prediction =
        exact !== undefined
          ? exact
          : candidate
            ? candidate.option
            : draft.valueChoices[i]?.get(truth.raw);
      if (prediction === truth.option) result.correctValues++;
    }
  }
  return result;
}

async function business(h, actor, object, parsed, draft, fields, answer) {
  const owner = draft.mapping.indexOf(OWNER);
  const dateOrders = { ...draft.dateOrders };
  for (const [i, key] of draft.mapping.entries()) {
    if (
      !['DATE', 'DATETIME'].includes(
        fields.find((f) => f.fieldKey === key)?.type,
      )
    )
      continue;
    const inferred = inferImportDateOrder(
      parsed?.rows.map((row) => row[i]) ?? [],
    );
    if (inferred === 'MDY' || inferred === 'DMY') dateOrders[i] ??= inferred;
  }
  const rows = parsed
    ? buildImportRows({
        ...draft,
        parsed,
        fields,
        timeZone: tenant.timeZone,
        dateOrders,
        destination: (row) => {
          if (owner === -1 || actor.role === 'EMPLOYEE')
            return { kind: 'default' };
          const raw = row[owner];
          const member = tenant.members.find((m) => m.displayName === raw);
          if (member) return { kind: 'member', id: member.fixtureMemberId };
          if (raw === '退件样员') return { kind: 'skip' };
          if (raw === '待分配样员') return { kind: 'pool' };
          return { kind: 'default' };
        },
      })
    : [];
  const matchFields = [
    ...new Set([
      ...draft.matchFields,
      ...answer.matchFields.filter((k) => draft.mapping.includes(k)),
    ]),
  ].slice(0, 3);
  const before = await h.snapshot();
  let batches = 0;
  const checked = await runGroupedImport({
    plan: { batchId: require('node:crypto').randomUUID(), matchFields, rows },
    shouldStop: () => false,
    request: async (body) => {
      assert.equal(body.dryRun, true);
      batches++;
      try {
        return await h.records.importRows(actor, object.code, body, {
          requestId: require('node:crypto').randomUUID(),
        });
      } catch (e) {
        if (!e.getStatus) throw e;
        return {
          items: body.rows.map((r) => ({
            rowNumber: r.rowNumber,
            status: 'FAILED',
            error: { code: e.code ?? e.getStatus() },
          })),
        };
      }
    },
  });
  assert.deepEqual(
    await h.snapshot(),
    before,
    'dryRun modified business state',
  );
  const result = {
    rows: answer.rows.length,
    ready: 0,
    conversionFailed: 0,
    serverFailed: 0,
    unprocessed: 0,
    existingDuplicate: 0,
    fileDuplicate: 0,
    ownerSkip: 0,
    expectedReady: answer.rows.filter((r) => r.status === 'READY').length,
    matchedReady: 0,
    readyWithoutValueLabels: 0,
    readyValuesMismatch: 0,
    missingRows: 0,
    wrongRows: 0,
    missingFields: 0,
    wrongFields: 0,
    wrongDetails: [],
    unexpectedRows: 0,
    batches,
    noWrites: true,
  };
  const actual = new Map(checked.items.map((i) => [i.rowNumber, i]));
  const byRow = new Map(rows.map((r) => [r.rowNumber, r]));
  const types = new Map(fields.map((f) => [f.fieldKey, f.type]));
  for (const truth of answer.rows) {
    const r = byRow.get(truth.rowNumber),
      item = actual.get(truth.rowNumber);
    if (!item) {
      result.unprocessed++;
      continue;
    }
    actual.delete(truth.rowNumber);
    if (item.status === 'READY') {
      result.ready++;
      if (truth.status === 'READY') result.matchedReady++;
      if (!truth.values) {
        result.readyWithoutValueLabels++;
        continue;
      }
      const { missing, wrong } = compareReady(truth.values, r.values, types);
      if (missing.length || wrong.length) result.readyValuesMismatch++;
      if (missing.length) result.missingRows++;
      if (wrong.length) result.wrongRows++;
      result.missingFields += missing.length;
      result.wrongFields += wrong.length;
      for (const issue of wrong) {
        const sources = draft.mapping.flatMap((key, i) =>
          key === issue.field || key === APPEND + issue.field
            ? [answer.columns[i]?.col ?? 'C' + (i + 1)]
            : [],
        );
        const expectedSources = answer.columns
          .filter((c) => c.target.field === issue.field)
          .map((c) => c.col);
        result.wrongDetails.push({
          rowNumber: truth.rowNumber,
          ...issue,
          sources,
          expectedSources,
          type: types.get(issue.field),
        });
      }
    } else if (item.status === 'FAILED') {
      if (r.error) result.conversionFailed++;
      else result.serverFailed++;
    } else if (item.status === 'SKIPPED') {
      if (r.destination.kind === 'skip') result.ownerSkip++;
      else if (
        matchFields.length &&
        tenant.existing.some((e) =>
          matchFields.every((k) => e[k] != null && e[k] === r.values[k]),
        )
      )
        result.existingDuplicate++;
      else result.fileDuplicate++;
    } else throw Error('Unexpected dryRun status');
  }
  result.unexpectedRows = actual.size;
  assert.equal(
    result.rows,
    result.ready +
      result.conversionFailed +
      result.serverFailed +
      result.unprocessed +
      result.existingDuplicate +
      result.fileDuplicate +
      result.ownerSkip,
    'every original row must have one outcome',
  );
  return result;
}
module.exports = { targetKey, score, business };
