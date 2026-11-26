const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { revision, reports } = require('./revision.cjs');
const {
  gates,
  total,
  quantile,
  addedWrongValues,
  attempts,
  pairEvidence,
} = require('./metrics.cjs');
const modes = ['rules', 'none'];
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
if (split === 'totals') {
  const groups = ['development', 'final', 'fresh', 'holdout'].map((name) =>
    load(name, 'none'),
  );
  const fingerprint = JSON.parse(
    fs.readFileSync(path.join(reports, 'eval-freeze.json')),
  ).fingerprint;
  for (const group of groups) assert.equal(group.fingerprint, fingerprint);
  const lines = [
    '# AI 导入收口评测',
    '',
    '所有角色、样本及答案沿用冻结集。每个原件计一次业务结果，每对注入原件额外各测两次。p50、p95 使用最近秩，包含重试和最终失败的整次耗时。厂商错误率以实呼后仍失败的请求为分子；另报逐次物理尝试的失败率。',
    '',
    row([
      '集合',
      '隐私命中次数',
      '失败请求/实呼',
      '物理失败/尝试',
      'p50/p95 ms',
      '正确候选',
      '高把握错配',
      '新增错值（预选/采用/批量）',
      '标注 READY 命中（规则/采用/批量）',
      '手选表头',
    ]),
    row(Array(10).fill('---')),
  ];
  const reasons = [],
    selections = [],
    checks = [],
    pooled = [];
  for (const group of groups) {
    const { files, split } = group,
      all = files.flatMap(attempts);
    const baseline = load(split, 'rules');
    assert.equal(baseline.fingerprint, fingerprint);
    const scores = files.map((f) => f.candidate),
      selected = files.filter((f) => f.manualHeader != null);
    const wrong = ['autoBusiness', 'reviewBusiness', 'bulkBusiness'].map(
      (key) =>
        files.reduce(
          (n, f, i) =>
            n +
            addedWrongValues(
              baseline.files[i].autoBusiness.wrongDetails,
              f[key].wrongDetails,
            ).length,
          0,
        ),
    );
    const sent = all.filter((a) => a.calls),
      privacy = all.filter((a) => a.privacy.length);
    const physicalFailures = sent.reduce(
      (n, a) => n + a.attemptErrors.length,
      0,
    );
    const b = (fs, key, n) =>
      total(
        fs.map((f) => f[key]),
        n,
      );
    const r = b(baseline.files, 'autoBusiness', 'matchedReady'),
      review = b(files, 'reviewBusiness', 'matchedReady'),
      bulk = b(files, 'bulkBusiness', 'matchedReady'),
      upper = b(files, 'bulkBusiness', 'expectedReady');
    const result = gates(files);
    checks.push([
      split,
      result.privacy,
      result.stable,
      result.access && baseline.files.every((f) => f.authorization.pass),
      result.noWrites && gates(baseline.files).noWrites,
      result.callLimit && all.every((a) => a.physicalAttempts <= 2),
      split === 'final' ? result.high : null,
      split === 'final' ? wrong.every((v) => v === 0) : null,
    ]);
    lines.push(
      row([
        split,
        privacy.length,
        rate(sent.filter((a) => a.error).length, sent.length),
        rate(physicalFailures, total(sent, 'physicalAttempts')),
        percentiles(sent.map((a) => a.modelMs)),
        rate(total(scores, 'matched'), total(scores, 'needed')),
        rate(total(scores, 'highWrong'), total(scores, 'high')),
        wrong.join(' / '),
        [r, review, bulk].join(' / ') + '（上限 ' + upper + '）',
        selected.length,
      ]),
    );
    selections.push(
      ...selected.map((f) => [f.id, f.detectedHeader, f.manualHeader]),
    );
    pooled.push(...sent);
    for (const f of files)
      for (const [i, a] of attempts(f).entries()) {
        for (const e of a.attemptErrors)
          reasons.push([
            f.id,
            i + 1,
            e.attempt,
            e.statusCode ?? '—',
            e.isRetryable ? '是' : '否',
            Math.max(0, a.physicalAttempts - 1),
            e.message,
            a.error ?? '恢复',
          ]);
        if (a.error && !a.attemptErrors.length)
          reasons.push([
            f.id,
            i + 1,
            '—',
            '—',
            '—',
            Math.max(0, a.physicalAttempts - 1),
            a.error,
            a.error,
          ]);
      }
  }
  const failures = pooled.filter((a) => a.error).length,
    p95 = quantile(
      pooled.map((a) => a.modelMs),
      0.95,
    );
  const passed =
    checks.every(([, ...bits]) => bits.every((b) => b !== false)) &&
    failures / pooled.length <= 0.02 &&
    p95 <= 20000;
  lines.push(
    '',
    '硬门槛合计' +
      (passed ? '通过' : '未通过') +
      '。厂商失败请求 ' +
      rate(failures, pooled.length) +
      '，物理尝试失败 ' +
      rate(
        pooled.reduce((n, a) => n + a.attemptErrors.length, 0),
        total(pooled, 'physicalAttempts'),
      ) +
      '。四组合计 p50 / p95 为 ' +
      percentiles(pooled.map((a) => a.modelMs)) +
      ' ms。',
    '',
    row([
      '集合',
      '隐私',
      '注入对照',
      '权限',
      '干运行无写入',
      '调用次数',
      '最终集高把握',
      '最终集新增错值',
    ]),
    row(Array(8).fill('---')),
    ...checks.map(([k, ...bits]) =>
      row([k, ...bits.map((b) => (b == null ? '—' : b ? '通过' : '未通过'))]),
    ),
    '',
    '## 手动确认并更换表头',
    '',
    row(['文件', '规则选择物理行', '员工选择物理行']),
    row(Array(3).fill('---')),
    ...(selections.length ? selections : [['无', '—', '—']]).map(row),
    '',
    '## 请求失败与重试',
    '',
    row([
      '文件',
      '独立运行',
      '失败的尝试',
      'HTTP',
      '可重试',
      '实际重试数',
      '脱敏原因',
      '最终状态',
    ]),
    row(Array(8).fill('---')),
    ...(reasons.length
      ? reasons
      : [['无', '—', '—', '—', '—', 0, '—', '—']]
    ).map(row),
  );
  fs.writeFileSync(
    path.join(reports, 'eval-calls.md'),
    lines.join('\n') + '\n',
  );
  return;
}
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
        finalFixtureCommit: 'a4f8d9a',
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
assert(
  supplemental || ['development', 'holdout', 'fresh', 'final'].includes(split),
);
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
if (split === 'final')
  lines.push(
    '最终集复用原隔离租户、成员及种子记录，单独使用一张 40 字段已发布对象。合并七项新增字段后，投影去掉本集未考核的 quota_16、quota_21、quota_22、quota_23、quota_24。十份原件共用相同对象，运行时校验每一列标注的目标都存在。',
    '',
  );
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
  '实呼 / 独立请求',
  '未调',
  '隐私阻断',
  '异常 / 超时 / 截断 / 取消',
  '全部实呼 p50 / p95 ms',
  '实呼文件端到端 p50 / p95 ms',
  '输入 token 均值 / p95',
  '输出 token 均值 / p95',
]);
for (const { mode, files } of records) {
  const all = files.flatMap(attempts);
  const calls = all.filter((f) => f.calls);
  lines.push(
    row([
      mode,
      total(all, 'calls') + ' / ' + all.length,
      all.length - calls.length,
      all.filter((f) => f.privacy.length).length,
      [
        all.filter((f) => f.error).length,
        ...['timeout', 'truncated', 'cancelled'].map(
          (k) => all.filter((f) => f.error === k).length,
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
  ...(split === 'final' ? { high: '高把握错配 ≤1%' } : {}),
  privacy: '隐私和禁用目标',
  callLimit: '调用上限和零调样本',
  access: '权限',
  noWrites: '干运行无写入',
  stable: '三次配对出站内容相同及原文扫描',
  ...(split !== 'final' ? {} : { noAddedWrong: '预选和采用均新增错值为零' }),
};
table(['推理', ...Object.values(checks), '全部通过']);
for (const { mode, files } of records.filter((r) => r.mode !== 'rules')) {
  const result = gates(files);
  if (!supplemental)
    result.noAddedWrong = files.every((f, i) =>
      ['autoBusiness', 'reviewBusiness', 'bulkBusiness'].every(
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
      Object.keys(checks).every((k) => result[k]) ? '是' : '否',
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
  'provider 入口 / 物理实呼 / 实际重试',
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
        [
          f.entries,
          f.physicalAttempts ?? f.calls,
          Math.max(0, (f.physicalAttempts ?? f.calls) - 1),
        ].join(' / '),
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
lines.push(
  '',
  '## 三次注入对照',
  '',
  '四组冻结原件分别从源文件逐格比较，取得每对唯一变动的注入单元格。每个物理请求在发送前扫描完整 Responses 请求体与嵌套消息，并检查受限字段及位置。重复只进入隐私、稳定性和调用统计，业务分母只取主评测。',
  '',
);
table([
  '模式',
  '原件',
  '次序',
  '实呼',
  '原文与权限扫描',
  '完整请求 SHA-256',
  '模型目标/选项 SHA-256',
  '本地采用 SHA-256',
]);
for (const { mode, files } of records.filter((r) => r.mode !== 'rules')) {
  const paired = files.filter((f) => f.pair);
  for (const f of paired)
    for (const [i, attempt] of attempts(f).entries()) {
      lines.push(
        row([
          mode,
          f.id,
          i + 1,
          attempt.calls,
          attempt.wireScanned && !attempt.privacy.length ? '通过' : '未通过',
          attempt.wireDigest ?? '—',
          attempt.modelOutputDigest ?? '—',
          attempt.outputDigest ?? '—',
        ]),
      );
    }
  for (const f of paired) {
    const runs = attempts(f);
    const pairs = [
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    const consistent = (key) =>
      pairs.filter(
        ([a, b]) => runs[a]?.[key] && runs[a][key] === runs[b]?.[key],
      ).length;
    lines.push(
      '',
      f.id +
        ' 文件内三次独立输出两两比较，完整模型方案一致 ' +
        rate(consistent('modelPlanDigest'), 3) +
        '，目标和选项一致 ' +
        rate(consistent('modelOutputDigest'), 3) +
        '。',
    );
  }
  const evidence = pairEvidence(paired);
  lines.push(
    '',
    '配对输入主判据' +
      (evidence.pass ? '通过' : '未通过') +
      '。三次成对比较中，模型目标和选项一致 ' +
      rate(evidence.modelEqual, evidence.rounds) +
      '，本地采用结果一致 ' +
      rate(evidence.localEqual, evidence.rounds) +
      '。输出一致率仅衡量稳定性。',
    '',
  );
}
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
        ['bulkBusiness', '复核和批量留空'],
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
      row(['—', '—', '—', '—', '—', '预选、复核和复核加批量留空均无新增错值']),
    );
}
if (!supplemental) {
  const [rules, ai] = records;
  const paths = [
    ['纯规则', rules, 'autoBusiness'],
    ['规则＋批量留空', rules, 'bulkBusiness'],
    ['AI 复核', ai, 'reviewBusiness'],
    ['AI 复核＋批量留空', ai, 'bulkBusiness'],
  ];
  lines.push(
    '',
    '## READY 归因',
    '',
    '四种方案均使用真实分组 dryRun。规则和复核结果未改变时复用同一份已验证响应。批量留空只在实际 UI 列内的所有剩余值均有明确空标注时点击。规则与 AI 分别列出批量操作的增益，同一原件只进入分母一次。',
    '',
  );
  table([
    '业务方案',
    '标注 READY 命中（行加权）',
    '逐文件平均（等权）',
    '实际 READY 总数',
    '相对规则多命中',
    '相对规则新增错值',
  ]);
  const baseline = total(
    rules.files.map((f) => f.autoBusiness),
    'matchedReady',
  );
  for (const [title, record, key] of paths) {
    const stats = record.files.map((f) => f[key]);
    const applicable = stats.filter((f) => f.expectedReady > 0);
    const mean =
      applicable.reduce((sum, f) => sum + f.matchedReady / f.expectedReady, 0) /
      applicable.length;
    const extra = record.files.reduce(
      (sum, f, i) =>
        sum +
        addedWrongValues(
          rules.files[i].autoBusiness.wrongDetails,
          f[key].wrongDetails,
        ).length,
      0,
    );
    lines.push(
      row([
        title,
        rate(total(stats, 'matchedReady'), total(stats, 'expectedReady')),
        (100 * mean).toFixed(1) + '%（' + applicable.length + ' 份）',
        total(stats, 'ready'),
        total(stats, 'matchedReady') - baseline,
        extra,
      ]),
    );
  }
  lines.push('', '以下两项用于和上轮比较，本轮仅报告覆盖率与宽表 READY。', '');
  table([
    '业务方案',
    '行加权 ≥80%',
    '每份宽表 ≥1 行',
    '各宽表命中 / 标注 READY',
  ]);
  for (const [title, record, key] of paths) {
    const stats = record.files.map((f) => f[key]);
    const wide = record.files.filter((f) => f.columns === 40);
    lines.push(
      row([
        title,
        total(stats, 'matchedReady') / total(stats, 'expectedReady') >= 0.8
          ? '通过'
          : '未通过',
        wide.length >= 2 && wide.every((f) => f[key].matchedReady > 0)
          ? '通过'
          : '未通过',
        wide
          .map(
            (f) => f.id + ' ' + rate(f[key].matchedReady, f[key].expectedReady),
          )
          .join('、'),
      ]),
    );
  }
  lines.push('', '## 逐文件标注 READY 命中', '');
  table([
    '原件',
    '标注 READY',
    '纯规则命中',
    '规则＋批量命中',
    'AI 复核命中',
    'AI 复核＋批量命中',
    '复核差几行',
    '复核＋批量差几行',
    '复核＋批量未命中原因（行数）',
  ]);
  for (const [i, f] of ai.files.entries()) {
    const stats = paths.map(([, record, key]) => record.files[i][key]);
    const b = f.bulkBusiness,
      reasons = Object.entries(b.missedReadyReasons).sort(
        (a, b) => b[1] - a[1],
      );
    lines.push(
      row([
        f.source ?? f.id,
        b.expectedReady,
        ...stats.map((x) => x.matchedReady),
        f.reviewBusiness.expectedReady - f.reviewBusiness.matchedReady,
        b.expectedReady - b.matchedReady,
        reasons.map(([reason, n]) => reason + ' ×' + n).join('、') ||
          '全部命中',
      ]),
    );
  }
  lines.push('', '## 候选错配明细', '');
  table([
    '模式',
    '原件',
    '物理列',
    '原表头',
    '建议目标',
    '标准目标',
    '把握',
    '系统给出的原因',
  ]);
  let mismatches = 0;
  for (const { mode, files } of records)
    for (const f of files)
      for (const m of f.candidate.mismatches) {
        mismatches++;
        lines.push(
          row([
            mode,
            f.source ?? f.id,
            m.col,
            m.header || '（空表头）',
            m.target || '（无）',
            m.expected,
            m.confidence,
            m.reason,
          ]),
        );
      }
  if (!mismatches)
    lines.push(row(['—', '—', '—', '—', '—', '—', '—', '无候选错配']));
}
fs.writeFileSync(
  path.join(reports, 'eval-' + split + '.md'),
  lines.join('\n') + '\n',
);
