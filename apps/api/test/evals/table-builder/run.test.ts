import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeAiProvider } from '../../../src/modules/ai/providers/fake-ai.provider';
import { blocksDelivery, evaluate, forgedProbes } from './run';
import { measure, previewViolations, type Sample } from './score';

const request: Sample = {
  id: 'policy',
  industry: 'test',
  description: '只建合同表',
  existingObjects: [],
  answers: [],
  mustCover: [
    {
      entity: '合同',
      fields: [
        { meaning: '状态', type: 'SINGLE_SELECT', options: ['草拟', '不存在'] },
        { meaning: '不存在', type: 'MEMBER' },
      ],
    },
  ],
  mustOmit: [],
  permissionCeiling: 'manual-default',
};
void test('records raw candidate, normalized admission, type and option denominators', async () => {
  const fake = new FakeAiProvider();
  const [r] = await evaluate(fake.generateTableBlueprint.bind(fake), [request]);
  assert.ok(
    r.audit.called && r.audit.raw && r.audit.eligible && r.audit.admitted,
  );
  assert.equal(blocksDelivery(r), false);
  const checks = measure(request, r.draft).checks;
  assert.deepEqual(checks.entities, [true]);
  assert.deepEqual(checks.types, [true, false]);
  assert.deepEqual(checks.options, [true, false]);
  assert.equal(r.draft?.kind, 'blueprint');
  if (r.draft?.kind === 'blueprint') {
    r.draft.blueprint.tables[0].fields[0].label = '负责人';
    Object.assign(r.draft.blueprint.tables[0], {
      employeeAccess: { canDelete: true },
    });
    r.audit.violations = previewViolations(r.draft);
    assert.equal(r.audit.violations.length, 2);
    assert.ok(blocksDelivery(r));
  }
});
void test('faults block delivery without logging provider errors; malformed raw settings are rejected', async () => {
  const [fault] = await evaluate(
    () => Promise.reject(new Error('private-test-marker')),
    [request],
  );
  assert.ok(blocksDelivery(fault));
  assert.equal(JSON.stringify(fault).includes('private-test-marker'), false);
  const [invalid] = await evaluate(
    () =>
      Promise.resolve({ employeeAccess: { secret: 'private-test-marker' } }),
    [request],
  );
  assert.equal(invalid.draft, null);
  assert.equal(invalid.audit.rejection?.code, 'VALIDATION_FAILED');
  assert.equal(JSON.stringify(invalid).includes('private-test-marker'), false);
});
void test('counts blocked name collisions independently of provider quality and refuses every forged confirm before persistence', async () => {
  const fake = new FakeAiProvider();
  const [r] = await evaluate(fake.generateTableBlueprint.bind(fake), [
    { ...request, existingObjects: ['合同'], expectConflict: true },
  ]);
  assert.equal(r.audit.eligible, false);
  assert.ok(
    r.draft?.kind === 'blueprint' &&
      r.draft.issues.some((i) => i.blocking && i.code === 'NAME_IN_USE'),
  );
  for (const probe of await forgedProbes())
    assert.ok(probe.passed && probe.writeCalls === 0);
});
