const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const empty = (value) =>
  value == null ||
  (typeof value === 'string' && !value.trim()) ||
  (Array.isArray(value) && !value.length);

function compareReady(expected, actual, types) {
  const missing = [],
    wrong = [];
  for (const field of new Set([
    ...Object.keys(expected),
    ...Object.keys(actual),
  ])) {
    const truth = expected[field],
      value = actual[field];
    if (empty(value)) {
      if (!empty(truth)) missing.push(field);
      continue;
    }
    const money = types.get(field) === 'MONEY';
    if (
      !empty(truth) &&
      (money
        ? Number(truth) === Number(value)
        : isDeepStrictEqual(truth, value))
    )
      continue;
    wrong.push({
      field,
      reason: empty(truth) ? 'unexpected' : 'different',
      digest: createHash('sha256')
        .update(JSON.stringify(money ? Number(value) : value))
        .digest('hex'),
    });
  }
  return { missing, wrong };
}

function addedWrongValues(baseline, observed) {
  const signature = ({ rowNumber, field, digest }) =>
    JSON.stringify([rowNumber, field, digest]);
  const known = new Set(baseline.map(signature));
  return observed.filter((issue) => !known.has(signature(issue)));
}

const total = (items, key) => items.reduce((n, item) => n + item[key], 0);
const quantile = (items, fraction) =>
  items.length
    ? [...items].sort((a, b) => a - b)[Math.ceil(fraction * items.length) - 1]
    : null;

function gates(files) {
  const scores = files.map((f) => f.candidate),
    reviews = files.map((f) => f.reviewBusiness);
  const wide = files.filter((f) => f.columns === 40);
  const calls = files.filter((f) => f.calls);
  const pairs = [...new Set(files.filter((f) => f.pair).map((f) => f.pair))];
  return {
    mismatch: total(scores, 'wrong') / total(scores, 'cols') <= 0.02,
    high: total(scores, 'highWrong') / total(scores, 'high') <= 0.01,
    coverage: total(scores, 'matched') / total(scores, 'needed') >= 0.8,
    ready:
      total(reviews, 'matchedReady') / total(reviews, 'expectedReady') >= 0.8,
    wideReady:
      wide.length >= 2 && wide.every((f) => f.reviewBusiness.matchedReady > 0),
    latency:
      calls.length > 0 &&
      calls.every((f) => Number.isFinite(f.modelMs)) &&
      quantile(
        calls.map((f) => f.modelMs),
        0.95,
      ) <= 20000,
    privacy: files.every(
      (f) =>
        !f.privacy.length &&
        !f.modelForbiddenTargets &&
        [f.candidate, f.auto, f.review].every((s) => !s.forbiddenTargets),
    ),
    callLimit: files.every(
      (f) => f.zeroCallPassed && f.calls <= 1 && f.entries <= 1,
    ),
    access: files.every((f) => f.authorization.pass),
    noWrites: files.every(
      (f) => f.autoBusiness.noWrites && f.reviewBusiness.noWrites,
    ),
    stable:
      pairs.length > 0 &&
      pairs.every((id) => {
        const pair = files.filter((f) => f.pair === id);
        if (pair.length !== 2 || pair.some((f) => f.error)) return false;
        if (
          !pair[0].outputDigest ||
          pair[0].outputDigest !== pair[1].outputDigest
        )
          return false;
        if (pair.every((f) => !f.entries && !f.calls)) return true;
        return (
          pair.every((f) => f.calls === 1) &&
          ['modelInputDigest', 'modelOutputDigest'].every(
            (key) => pair[0][key] && pair[0][key] === pair[1][key],
          )
        );
      }),
  };
}
module.exports = { compareReady, addedWrongValues, total, quantile, gates };
