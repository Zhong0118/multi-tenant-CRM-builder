const assert = require('node:assert/strict');
const { api, tenant } = require('./runtime.cjs');
const compact = (s) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{Pd}()+.]/gu, '');
function guard(input, answer, resolved, actors) {
  const payload = JSON.stringify(input).normalize('NFKC').toLowerCase();
  const normalized = compact(payload);
  const hits = new Set();
  const check = (kind, raw) => {
    if (!raw) return;
    const v = String(raw).normalize('NFKC').trim().toLowerCase();
    const n = compact(v);
    if (
      payload.includes(v) ||
      (n.length >= 7 && normalized.includes(n)) ||
      (/^861[3-9]\d{9}$/.test(n) && normalized.includes(n.slice(2)))
    )
      hits.add(kind);
  };
  for (const s of answer.forbidden) check(s.kind, s.value);
  // Excel may expose a number in its display form or as decimal digits.
  // Include identifiers found in the raw cells as well as the fixture sentinels.
  for (const row of answer.rows)
    for (const raw of row.cells) {
      for (const value of raw.match(/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? [])
        check('sourceEmail', value);
      for (const value of raw.match(/(?:\+?\d[\s().\p{Pd}]*){7,}\d[xX]?/gu) ??
        []) {
        const digits = compact(value);
        if (/^\d{4}-\d{2}-\d{2}(?:[ T]|$)/.test(raw)) continue;
        if (
          digits.length >= 10 ||
          /^(?:0\d{2,3}[- ]|1[3-9]\d{9}$)/.test(value)
        ) {
          check('sourceIdentifier', value);
          if (/^\d{15,19}$/.test(digits))
            check('numericDisplay', String(Number(digits)));
        }
      }
    }
  for (const m of tenant.members) {
    check('member', m.displayName);
    check('member', m.fixtureMemberId);
  }
  for (const a of Object.values(actors)) {
    check('identity', a.userId);
    check('identity', a.memberId);
  }
  for (const f of resolved.schema.fields) {
    check('fieldUUID', f.id);
    if (answer.forbiddenTargets.includes(f.fieldKey)) {
      check('restrictedKey', f.fieldKey);
      check('restrictedLabel', f.label);
    }
  }
  for (const row of input.candidates)
    for (const c of row.columns) {
      const col = answer.columns.find((x) => x.col === c.col);
      if (col?.localOnly) hits.add('restrictedPosition');
      if (col?.locked && (c.samples.length || c.values.length))
        hits.add('lockedSamples');
      if (c.locked && !/^F\d+$/.test(c.locked.field))
        hits.add('rawFieldReference');
    }
  if (input.fields.some((f) => !/^F\d+$/.test(f.ref)))
    hits.add('rawFieldReference');
  return [...hits].sort();
}
function observedProvider(mode, answer, resolved, h, log) {
  const { VercelOpenAiProvider } = api(
    'modules/ai/providers/vercel-openai.provider',
  );
  const { ModelMeter } = api('modules/ai/governance/model-meter');
  const ledger = h.app.get(
    api('modules/ai/governance/ai-ledger.service').AiLedgerService,
  );
  const limiter = h.app.get(
    api('infrastructure/rate-limit/rate-limiter').RATE_LIMITER,
  );
  return {
    async generateImportAssist(input, actor, signal) {
      log.entries++;
      assert.equal(log.entries, 1);
      log.privacy = guard(input, answer, resolved, h.actors);
      if (log.privacy.length) throw Error('PRIVACY_GATE');
      const config = {
        baseURL: process.env.AI_BASE_URL,
        apiKey: process.env.AI_API_KEY,
        modelKey: process.env.AI_MODEL,
        protocol: 'responses',
      };
      assert(
        config.apiKey &&
          config.modelKey === 'deepseek-flash' &&
          new URL(config.baseURL).hostname === 'api.deepseek.com',
      );
      const provider = new VercelOpenAiProvider({
        ...config,
        onUsage: (u) => {
          log.inputTokens = u.inputTokens ?? null;
          log.outputTokens = u.outputTokens ?? null;
        },
        meter: (context, feature, provider, model) => {
          const meter = new ModelMeter(
            ledger,
            limiter,
            context,
            feature,
            provider,
            model,
          );
          const send = meter.fetch;
          meter.fetch = async (url, init) => {
            const body = JSON.parse(init.body);
            assert.equal(
              body.reasoning?.effort,
              mode === 'none' ? 'none' : undefined,
            );
            const original = meter.onSend;
            meter.onSend = async () => {
              assert.equal(++log.calls, 1);
              await original?.();
            };
            return send(url, init);
          };
          return meter;
        },
      });
      const start = performance.now();
      try {
        const output = await provider.generateImportAssist(
          input,
          actor,
          signal,
          mode,
        );
        const forbidden = new Set(
          resolved.schema.fields
            .filter((f) => answer.forbiddenTargets.includes(f.fieldKey))
            .flatMap((f) => [f.id, f.fieldKey, f.label]),
        );
        const suggestions = Array.isArray(output?.columns)
          ? output.columns
          : [];
        log.modelForbiddenTargets = suggestions.filter((s) =>
          forbidden.has(s?.target?.field),
        ).length;
        log.modelForbiddenTargets += (
          Array.isArray(output?.matchFields) ? output.matchFields : []
        ).filter((k) => forbidden.has(k)).length;
        if (answer.pair) {
          const semantic = suggestions
            .map((s) => [
              s?.col,
              s?.target?.mode,
              s?.target?.field ?? null,
              (Array.isArray(s?.values) ? s.values : [])
                .map((v) => [v?.value, v?.option])
                .sort(),
            ])
            .sort();
          log.modelOutputDigest = require('node:crypto')
            .createHash('sha256')
            .update(JSON.stringify([output?.headerRow, semantic]))
            .digest('hex');
        }
        return output;
      } catch (e) {
        log.error =
          e.finishReason === 'length'
            ? 'truncated'
            : signal.aborted
              ? 'timeout'
              : (e.code ?? e.name ?? 'providerError');
        throw e;
      } finally {
        log.modelMs = Math.round(performance.now() - start);
      }
    },
  };
}
module.exports = { observedProvider };
