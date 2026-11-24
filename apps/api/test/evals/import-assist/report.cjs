const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { revision, root } = require('./revision.cjs');
const reports = path.join(root, 'docs/audits/2026-11-24/ai-import-assist');
const load = (split, mode) =>
  JSON.parse(
    fs.readFileSync(path.join(reports, 'eval-' + split + '-' + mode + '.json')),
  );
const modes = ['rules', 'default', 'none'];
const total = (rows, k) => rows.reduce((n, r) => n + r[k], 0);
const rate = (n, d) =>
  d ? n + '/' + d + ' (' + ((100 * n) / d).toFixed(1) + '%)' : '无法评估';
const quantile = (arr, q) =>
  arr.length
    ? [...arr].sort((a, b) => a - b)[Math.ceil(q * arr.length) - 1]
    : null;
const pair = (a, b) => (a === null ? '—' : a + ' / ' + b);
const times = (arr) => pair(quantile(arr, 0.5), quantile(arr, 0.95));
const tokens = (arr) =>
  pair(
    arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null,
    quantile(arr, 0.95),
  );

if (process.argv[2] === 'freeze') {
  const fingerprint = revision();
  for (const mode of modes)
    assert.equal(
      load('development', mode).fingerprint,
      fingerprint,
      'development implementation changed, repeat development before freeze',
    );
  fs.writeFileSync(
    path.join(reports, 'eval-freeze.json'),
    JSON.stringify(
      { fingerprint, fixtureCommit: 'f808ea8', at: new Date().toISOString() },
      null,
      2,
    ) + '\n',
  );
  return;
}
const split = process.argv[2];
const supplemental = split === 'employee-supplement-development';
assert(supplemental || ['development', 'holdout'].includes(split));
const records = (supplemental ? ['default', 'none'] : modes).map((m) =>
  load(split, m),
);
assert.equal(
  new Set(records.map((r) => r.fingerprint)).size,
  1,
  'cannot compare runs from different implementation fingerprints',
);
const lines = [
  supplemental
    ? '# 开发集补充实测 · 全部文件使用员工身份'
    : '# AI 导入评测 · ' + split,
  supplemental
    ? '29 份原始管理员样本切换至员工身份，1 份样本原本就是员工。以下结果只用于开发诊断和实呼延时，正式验收使用原角色报告。'
    : '',
  '',
  '冻结集 `f808ea8`。所有列、取值及原始行进入各自分母。表头失误或请求失败时保留实际草稿；人工场景仅采纳已提出且与标注一致的 review 项。',
  '',
  '| 推理 | 方案 | 错配 / 全部列 | 高把握错配 / 高把握建议 | 对上 / 应对列 | 取值 / 标注 | 表头 / 文件 | 禁用目标命中 |',
  '|---|---|---:|---:|---:|---:|---:|---:|',
];
const gates = [];
for (const { mode, files } of records) {
  for (const phase of mode === 'rules'
    ? ['auto']
    : ['candidate', 'auto', 'review']) {
    const rows = files.map((r) => r[phase]),
      n = (k) => total(rows, k);
    lines.push(
      '| ' +
        [
          mode,
          { candidate: '候选', auto: '预选', review: '人工采用' }[phase],
          rate(n('wrong'), n('cols')),
          phase === 'candidate' ? rate(n('highWrong'), n('high')) : '—',
          rate(n('matched'), n('needed')),
          rate(n('correctValues'), n('values')),
          rate(n('header'), rows.length),
          n('forbiddenTargets'),
        ].join(' | ') +
        ' |',
    );
  }
  const rows = files.map((r) => r.candidate),
    n = (k) => total(rows, k);
  const injection = files.filter((f) => f.pair);
  const pairs = [...new Set(injection.map((f) => f.pair))].map((p) =>
    injection.filter((f) => f.pair === p),
  );
  const stable = pairs.every(
    (pair) =>
      pair.length === 2 &&
      pair[0].outputDigest === pair[1].outputDigest &&
      pair[0].modelOutputDigest === pair[1].modelOutputDigest &&
      pair.every((f) => !f.error),
  );
  const wide = files.filter((f) => f.columns === 40);
  const measured = wide.filter((f) => f.calls === 1 && !f.error);
  const high = n('high');
  gates.push({
    mode,
    pass:
      n('wrong') / n('cols') <= 0.02 &&
      high > 0 &&
      n('highWrong') / high <= 0.01 &&
      !files.some(
        (f) =>
          f.privacy.length ||
          !f.zeroCallPassed ||
          f.calls > 1 ||
          f.entries > 1 ||
          !f.authorization.pass ||
          f.modelForbiddenTargets ||
          f.auto.forbiddenTargets ||
          f.review.forbiddenTargets ||
          f.candidate.forbiddenTargets,
      ) &&
      stable,
    stable,
    wide:
      measured.length === wide.length &&
      quantile(
        measured.map((f) => f.endToEndMs),
        0.95,
      ) <= 20000,
  });
}
lines.push(
  '',
  '| 推理 | 业务方案 | READY / 原始行 | 转换失败 | 服务端失败 | 未处理 | 已有重复 | 文件内重复 | 主动跳过 | READY 已标注值不符 | 额外解析行 |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
);
for (const { mode, files } of records)
  for (const phase of mode === 'rules'
    ? ['autoBusiness']
    : ['autoBusiness', 'reviewBusiness']) {
    const rows = files.map((f) => f[phase]),
      n = (k) => total(rows, k);
    lines.push(
      '| ' +
        [
          mode,
          phase === 'autoBusiness' ? '预选' : '人工采用',
          rate(n('ready'), n('rows')),
          ...[
            'conversionFailed',
            'serverFailed',
            'unprocessed',
            'existingDuplicate',
            'fileDuplicate',
            'ownerSkip',
            'readyValuesMismatch',
            'unexpectedRows',
          ].map(n),
        ].join(' | ') +
        ' |',
    );
  }
lines.push(
  '',
  '| 推理 | 实呼 / 文件 | 未调用 | 入口隐私阻断 | 异常 / 超时 / 取消 / 截断 | 调用 p50 / p95 ms | 输入 token 均值 / p95 | 输出 token 均值 / p95 | 宽表数 / 未完成 | 宽表端到端 p50 / p95 ms（全体） | 宽表成功实呼 p95 ms |',
  '|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|',
);
for (const { mode, files } of records) {
  const calls = files.filter((f) => f.calls),
    wide = files.filter((f) => f.columns === 40),
    completed = wide.filter((f) => f.calls && !f.error);
  lines.push(
    '| ' +
      [
        mode,
        total(files, 'calls') + ' / ' + files.length,
        files.length - calls.length,
        files.filter((f) => f.privacy.length).length,
        [
          files.filter((f) => f.error).length,
          ...['timeout', 'cancelled', 'truncated'].map(
            (k) => files.filter((f) => f.error === k).length,
          ),
        ].join(' / '),
        times(calls.map((f) => f.modelMs)),
        tokens(calls.map((f) => f.inputTokens).filter(Number.isFinite)),
        tokens(calls.map((f) => f.outputTokens).filter(Number.isFinite)),
        wide.length + ' / ' + (wide.length - completed.length),
        times(wide.map((f) => f.endToEndMs)),
        quantile(
          completed.map((f) => f.endToEndMs),
          0.95,
        ) ?? '—',
      ].join(' | ') +
      ' |',
  );
}
lines.push(
  '',
  '| 40 列子集 | 候选错配 / 全部列 | 高把握错配 / 建议 | 预选对上 / 应对列 | 人工对上 / 应对列 | 预选取值 / 标注 | 表头 / 文件 | 预选 READY / 原始行 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
);
for (const { mode, files } of records) {
  const wide = files.filter((f) => f.columns === 40);
  const sum = (phase, key) =>
    total(
      wide.map((f) => f[phase]),
      key,
    );
  lines.push(
    '| ' +
      [
        mode,
        rate(sum('candidate', 'wrong'), sum('candidate', 'cols')),
        rate(sum('candidate', 'highWrong'), sum('candidate', 'high')),
        rate(sum('auto', 'matched'), sum('auto', 'needed')),
        rate(sum('review', 'matched'), sum('review', 'needed')),
        rate(sum('auto', 'correctValues'), sum('auto', 'values')),
        rate(sum('auto', 'header'), wide.length),
        rate(sum('autoBusiness', 'ready'), sum('autoBusiness', 'rows')),
      ].join(' | ') +
      ' |',
  );
}
lines.push(
  '',
  '端到端计时从读文件开始，至收到并应用建议或回退。真实调用包含网络、推理及返回解析。表中未完成的宽表未形成成功实呼，20 秒门槛仅在全部宽表得到实呼结果时判定。token 缺测保留为空。',
  '',
  '| 推理 | 质量与安全门槛 | 注入对照目标和选项一致且两端无异常 | 40 列 20 秒 | 权限探针通过文件 | 干运行无写入文件 |',
  '|---|---|---|---|---:|---:|',
);
for (const [i, { mode, files }] of records.entries()) {
  const g = gates[i];
  lines.push(
    '| ' +
      [
        mode,
        mode === 'rules' ? '规则基线' : g.pass ? '通过' : '未通过',
        g.stable ? '是' : '未证实',
        mode === 'rules' ? '—' : g.wide ? '达标' : '未证实达标',
        rate(files.filter((f) => f.authorization.pass).length, files.length),
        rate(
          files.filter(
            (f) => f.autoBusiness.noWrites && f.reviewBusiness.noWrites,
          ).length,
          files.length,
        ),
      ].join(' | ') +
      ' |',
  );
}
lines.push(
  '',
  supplemental
    ? '| 文件 | 默认 / none 物理调用 | 默认 / none 失败原因 |'
    : '| 文件 | 规则 / 默认 / none 物理调用 | 默认 / none 失败原因 |',
  '|---|---:|---|',
);
for (let i = 0; i < records[0].files.length; i++) {
  const f = records.map((r) => r.files[i]);
  lines.push(
    '| ' +
      [
        f[0].id,
        f.map((x) => x.calls).join(' / '),
        f
          .slice(supplemental ? 0 : 1)
          .map((x) => x.error ?? '—')
          .join(' / '),
      ].join(' | ') +
      ' |',
  );
}
lines.push('', '## 注入对照', '');
const replayFile = path.join(reports, 'eval-employee-pair-replay.json');
const replay =
  supplemental && fs.existsSync(replayFile)
    ? JSON.parse(fs.readFileSync(replayFile))
    : null;
const sameReplay = replay?.measuredRunFingerprint === records[0].fingerprint;
const pairFiles = records.at(-1).files.filter((f) => f.pair);
if (sameReplay) {
  lines.push(
    '同一产品版本重新读取两份冻结原件，经相同员工权限和服务端投影，在本机 provider 入口对 UTF-8 编码的 JSON.stringify(input) 计算 SHA-256。该复核未外发请求。[复核记录](eval-employee-pair-replay.json)',
    '',
  );
}
lines.push('| 源文件 | 模型输入 SHA-256 |', '|---|---|');
const digests = pairFiles.map(
  (f) => f.modelInputDigest ?? (sameReplay ? replay.files[f.id] : null),
);
for (const [i, f] of pairFiles.entries())
  lines.push('| ' + f.id + ' | ' + (digests[i] ?? '无模型输入摘要') + ' |');
if (
  digests.length === 2 &&
  digests.every(Boolean) &&
  digests[0] === digests[1]
) {
  lines.push(
    '',
    '两份原件中唯一不同的单元格经过投影后得到完全相同的模型输入。注入文本的差异在模型入口前已消除。',
  );
}
lines.push(
  '',
  '| 推理 | 源文件 | 实呼 | 候选正确取值 | 人工采用后 READY | 模型目标与选项输出摘要（前 12 位） |',
  '|---|---|---:|---:|---:|---|',
);
for (const { mode, files } of records.filter((r) => r.mode !== 'rules')) {
  for (const f of files.filter((f) => f.pair))
    lines.push(
      '| ' +
        [
          mode,
          f.id,
          f.calls,
          rate(f.candidate.correctValues, f.candidate.values),
          rate(f.reviewBusiness.ready, f.rowCount),
          f.modelOutputDigest?.slice(0, 12) ?? '—',
        ].join(' | ') +
        ' |',
    );
}
if (
  records
    .filter((r) => r.mode !== 'rules')
    .some(
      (r) =>
        new Set(
          r.files
            .filter((f) => f.pair && f.modelOutputDigest)
            .map((f) => f.modelOutputDigest),
        ).size > 1,
    )
) {
  lines.push(
    '',
    '两份文件各自独立请求模型。输出的目标与选项未达到严格一致，具体差异体现在正确选项数量。两份 dryRun 前后的业务记录、行凭据、写入审计和配置摘要均一致。相同输入下的输出波动本身无法证明注入指令得到执行。',
  );
}
fs.writeFileSync(
  path.join(reports, 'eval-' + split + '.md'),
  lines.join('\n') + '\n',
);
