const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { revision, reports } = require('./revision.cjs');
const { gates, total, quantile, addedWrongValues } = require('./metrics.cjs');
const modes = ['rules', 'default', 'none'];
const load = (split, mode) =>
  JSON.parse(
    fs.readFileSync(path.join(reports, 'eval-' + split + '-' + mode + '.json')),
  );
const rate = (n, d) =>
  d ? n + '/' + d + ' (' + ((100 * n) / d).toFixed(1) + '%)' : '无法评估';
const percentiles = (values) =>
  values.length && values.every(Number.isFinite)
    ? [0.5, 0.95].map((q) => quantile(values, q)).join(' / ')
    : '—';
const tokenStats = (values) => {
  const present = values.filter(Number.isFinite);
  return present.length
    ? [
        Math.round(present.reduce((sum, v) => sum + v, 0) / present.length),
        quantile(present, 0.95),
      ].join(' / ') +
        ' (' +
        present.length +
        ')'
    : '—';
};
const row = (cells) => '| ' + cells.join(' | ') + ' |';
const split = process.argv[2];
if (split === 'freeze') {
  const fingerprint = revision();
  for (const mode of modes)
    assert.equal(
      load('development', mode).fingerprint,
      fingerprint,
      'development run differs from current implementation',
    );
  fs.writeFileSync(
    path.join(reports, 'eval-freeze.json'),
    JSON.stringify(
      {
        fingerprint,
        developmentFixtureCommit: 'f808ea8',
        freshFixtureCommit: '49217f9a5dcbcd01b99f83593a138c274a5cf17d',
        at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  return;
}
const supplemental = split === 'employee-supplement-development';
assert(supplemental || ['development', 'holdout', 'fresh'].includes(split));
const records = (supplemental ? modes.slice(1) : modes).map((mode) =>
  load(split, mode),
);
const first = records[0];
for (const record of records) {
  assert.equal(record.fingerprint, first.fingerprint);
  assert.equal(record.manifestHash, first.manifestHash);
  assert.deepEqual(
    record.files.map((f) => [f.id, f.actor, f.columns, f.rowCount]),
    first.files.map((f) => [f.id, f.actor, f.columns, f.rowCount]),
  );
}
const lines = [
  '# AI 导入评测 · ' + split,
  '',
  '原件与答案冻结于 `' +
    first.fixtureCommit +
    '`，实施与评分指纹为 `' +
    first.fingerprint +
    '`。',
  '所有原始列、值标注和物理行进入各自分母。人工仅采用模型实际提出且与标注一致的复核建议。',
  '',
];
function table(headers) {
  lines.push(row(headers), row(headers.map(() => '---')));
}
table([
  '推理',
  '方案',
  '错配 / 全部列',
  '高把握错配 / 高把握建议',
  '对上 / 应对列',
  '取值 / 标注',
  '表头 / 文件',
  '禁用目标命中',
]);
for (const { mode, files } of records) {
  for (const [key, title] of [
    ['candidate', '候选'],
    ['auto', '预选'],
    ['review', '人工采用'],
  ]) {
    if (mode === 'rules' && key !== 'auto') continue;
    const scores = files.map((f) => f[key]),
      n = (k) => total(scores, k);
    lines.push(
      row([
        mode,
        title,
        rate(n('wrong'), n('cols')),
        key === 'candidate' ? rate(n('highWrong'), n('high')) : '—',
        rate(n('matched'), n('needed')),
        rate(n('correctValues'), n('values')),
        rate(n('header'), files.length),
        n('forbiddenTargets'),
      ]),
    );
  }
}
lines.push(
  '',
  '## 实际 dryRun',
  '',
  '达到上限的比例按同一物理行计数，分子为标注 READY 且实际 READY 的行，分母为完整正确方案的标注 READY 行。实际 READY 总数另外列出。',
  '',
);
table([
  '推理',
  '业务方案',
  'READY / 原始行',
  '达到标注 READY 上限',
  '转换失败',
  '服务端失败',
  '未处理',
  '已有重复',
  '文件内重复',
  '主动跳过',
  '额外解析行',
]);
for (const { mode, files } of records) {
  for (const [key, title] of [
    ['autoBusiness', '预选'],
    ['reviewBusiness', '人工采用'],
  ]) {
    if (mode === 'rules' && key !== 'autoBusiness') continue;
    const summaries = files.map((f) => f[key]),
      n = (k) => total(summaries, k);
    lines.push(
      row([
        mode,
        title,
        rate(n('ready'), n('rows')),
        rate(n('matchedReady'), n('expectedReady')),
        ...[
          'conversionFailed',
          'serverFailed',
          'unprocessed',
          'existingDuplicate',
          'fileDuplicate',
          'ownerSkip',
          'unexpectedRows',
        ].map(n),
      ]),
    );
  }
}
lines.push(
  '',
  '仅对有值标注的实际 READY 行核对字段。缺值表示应有的值为空。错值表示写入了不同的非空值，包含额外字段。行数按物理行去重，同一行可同时缺值和错值。字段数按原始行与字段的组合计数。',
  '',
);
table([
  '推理',
  '业务方案',
  'READY 有值标注 / 全部 READY',
  '任一差异行',
  '缺值行',
  '缺值字段',
  '错值行',
  '错值字段',
]);
for (const { mode, files } of records)
  for (const [key, title] of [
    ['autoBusiness', '预选'],
    ['reviewBusiness', '人工采用'],
  ]) {
    if (mode === 'rules' && key !== 'autoBusiness') continue;
    const summaries = files.map((f) => f[key]),
      n = (k) => total(summaries, k);
    lines.push(
      row([
        mode,
        title,
        rate(n('ready') - n('readyWithoutValueLabels'), n('ready')),
        ...[
          'readyValuesMismatch',
          'missingRows',
          'missingFields',
          'wrongRows',
          'wrongFields',
        ].map(n),
      ]),
    );
  }

lines.push(
  '',
  '## 调用、权限与门槛',
  '',
  '实呼计时包含超时、截断和其他异常，从 provider 开始处理到完成或回退。p50 与 p95 使用最近秩，20 秒门槛取全部实呼 p95；输入和输出 token 的括号为有读数的调用数。',
  '',
);
table([
  '推理',
  '实呼 / 文件',
  '未调',
  '隐私阻断',
  '异常 / 超时 / 截断 / 取消',
  '全部实呼 p50 / p95 ms',
  '实呼文件端到端 p50 / p95 ms',
  '输入 token 均值 / p95',
  '输出 token 均值 / p95',
]);
for (const { mode, files } of records) {
  const calls = files.filter((f) => f.calls);
  lines.push(
    row([
      mode,
      total(files, 'calls') + ' / ' + files.length,
      files.length - calls.length,
      files.filter((f) => f.privacy.length).length,
      [
        files.filter((f) => f.error).length,
        ...['timeout', 'truncated', 'cancelled'].map(
          (k) => files.filter((f) => f.error === k).length,
        ),
      ].join(' / '),
      percentiles(calls.map((f) => f.modelMs)),
      percentiles(calls.map((f) => f.endToEndMs)),
      tokenStats(calls.map((f) => f.inputTokens)),
      tokenStats(calls.map((f) => f.outputTokens)),
    ]),
  );
}
lines.push('');
const checks = {
  mismatch: '候选错配 ≤2%',
  high: '高把握错配 ≤1%',
  coverage: '候选对上 ≥80%',
  ready: '采用后达到上限 ≥80%',
  wideReady: '每份宽表有 READY',
  latency: '全部实呼 p95 ≤20s',
  privacy: '隐私和禁用目标',
  callLimit: '调用上限和零调样本',
  access: '权限',
  noWrites: '干运行无写入',
  stable: '注入对照',
  ...(supplemental ? {} : { noAddedWrong: '预选和采用均新增错值为零' }),
};
table(['推理', ...Object.values(checks), '全部通过']);
for (const { mode, files } of records.filter((r) => r.mode !== 'rules')) {
  const result = gates(files);
  if (!supplemental)
    result.noAddedWrong = files.every((f, i) =>
      ['autoBusiness', 'reviewBusiness'].every(
        (key) =>
          !addedWrongValues(
            first.files[i].autoBusiness.wrongDetails,
            f[key].wrongDetails,
          ).length,
      ),
    );

  lines.push(
    row([
      mode,
      ...Object.keys(checks).map((k) => (result[k] ? '通过' : '未通过')),
      Object.values(result).every(Boolean) ? '是' : '否',
    ]),
  );
}
lines.push('', '## 40 列原件', '');
table([
  '推理',
  '文件',
  '实呼',
  '端到端 ms',
  '候选错配 / 全部',
  '高把握错配 / 建议',
  '候选对上 / 应对列',
  '预选对上 / 应对列',
  '采用对上 / 应对列',
  '预选 READY / 全部',
  '采用 READY / 全部',
  '采用达到上限',
]);
for (const { mode, files } of records)
  for (const f of files.filter((f) => f.columns === 40))
    lines.push(
      row([
        mode,
        f.id,
        f.calls,
        f.endToEndMs,
        rate(f.candidate.wrong, f.candidate.cols),
        rate(f.candidate.highWrong, f.candidate.high),
        rate(f.candidate.matched, f.candidate.needed),
        rate(f.auto.matched, f.auto.needed),
        rate(f.review.matched, f.review.needed),
        rate(f.autoBusiness.ready, f.rowCount),
        rate(f.reviewBusiness.ready, f.rowCount),
        rate(f.reviewBusiness.matchedReady, f.reviewBusiness.expectedReady),
      ]),
    );
lines.push('', '## 每份原件', '');
table([
  '文件',
  '模式',
  'provider 入口 / 实呼',
  '失败原因',
  '模型 ms',
  '拒导入 / 缺权益 / 调用数',
  '干运行无写入',
]);
for (let i = 0; i < first.files.length; i++)
  for (const { mode, files } of records) {
    const f = files[i];
    lines.push(
      row([
        f.id,
        mode,
        [f.entries, f.calls].join(' / '),
        f.error ?? '—',
        f.modelMs ?? '—',
        [
          f.authorization.canImport,
          f.authorization.entitled,
          f.authorization.calls,
        ].join(' / '),
        f.autoBusiness.noWrites && f.reviewBusiness.noWrites ? '是' : '否',
      ]),
    );
  }
lines.push('', '## 注入对照', '');
table([
  '推理',
  '文件',
  '实呼',
  '模型输入摘要',
  '模型目标和选项摘要',
  '本地采用摘要',
  '人工采用后 READY / 原始行',
]);
for (const { mode, files } of records)
  for (const f of files.filter((f) => f.pair))
    lines.push(
      row([
        mode,
        f.id,
        f.calls,
        f.modelInputDigest ?? '—',
        f.modelOutputDigest ?? '—',
        f.outputDigest ?? '—',
        rate(f.reviewBusiness.ready, f.rowCount),
      ]),
    );
if (!supplemental) {
  lines.push(
    '',
    '## 相对纯规则新增的错值',
    '',
    '同一文件、原始行和字段出现新的错误非空值即列入。规则未达到 READY 而新增可写的错误值也列入；同一位置与规则等价的既有错值扣除。来源仅列物理列编号。',
    '',
  );
  table(['推理', '业务方案', '文件', '原始行', '字段', '原因与来源']);
  let count = 0;
  for (const { mode, files } of records.filter((r) => r.mode !== 'rules'))
    for (const [i, f] of files.entries())
      for (const [key, title] of [
        ['autoBusiness', '预选'],
        ['reviewBusiness', '人工采用'],
      ]) {
        const extra = addedWrongValues(
          first.files[i].autoBusiness.wrongDetails,
          f[key].wrongDetails,
        );
        for (const issue of extra) {
          const observed = issue.sources.join('+') || '无',
            expected = issue.expectedSources.join('+') || '无';
          const reason =
            issue.reason === 'unexpected'
              ? '应为空却有非空值'
              : '非空值与标注不符';
          lines.push(
            row([
              mode,
              title,
              f.id,
              issue.rowNumber,
              issue.field,
              reason +
                '，' +
                issue.type +
                ' 字段，实际来源 ' +
                observed +
                '，标注来源 ' +
                expected,
            ]),
          );
          count++;
        }
      }
  if (!count)
    lines.push(
      row(['—', '—', '—', '—', '—', '两种推理与采用阶段均无新增错值']),
    );
}
fs.writeFileSync(
  path.join(reports, 'eval-' + split + '.md'),
  lines.join('\n') + '\n',
);
