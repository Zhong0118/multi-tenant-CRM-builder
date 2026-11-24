const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const tenant = require('./fixtures/tenant.json');

const webRoot = path.resolve(__dirname, '../../../../web/src');
const xlsxRoot = path.resolve(webRoot, '../node_modules/xlsx');
require('ts-node').register({
  project: path.resolve(__dirname, '../../../tsconfig.json'),
  transpileOnly: true,
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node',
    resolvePackageJsonExports: false,
  },
  moduleTypes: { '../web/**/*': 'cjs' },
});
require('tsconfig-paths').register({
  baseUrl: webRoot,
  paths: {
    '@/*': ['*'],
    xlsx: [xlsxRoot + '/xlsx.mjs'],
    'xlsx/dist/cpexcel.full.mjs': [xlsxRoot + '/dist/cpexcel.full.mjs'],
  },
});
const web = (name) =>
  require(path.join(webRoot, 'features/records', name + '.ts'));
const api = (name) => require(path.join(__dirname, '../../../src', name));

async function runtime() {
  require('../../helpers/isolated-database').assertIsolatedTestDatabase(
    process.env.TEST_DATABASE_URL,
    process.env.TEST_DATABASE_ADMIN_URL,
  );
  assert.equal(
    new URL(process.env.TEST_DATABASE_URL).pathname,
    '/crm_pr2_import_eval_test',
  );
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.DEV_VERIFICATION_CODE = '123456';
  const { createDatabaseClient } = require('@crm/database');
  const db = createDatabaseClient(process.env.TEST_DATABASE_ADMIN_URL);
  const { NestFactory } = require('@nestjs/core');
  const app = await NestFactory.createApplicationContext(
    api('app.module').AppModule,
    { logger: false, abortOnError: false },
  );
  const get = (file, name) => app.get(api(file)[name]);
  const code = 'import-eval-pr2';
  let workspace = await db.tenant.findUnique({ where: { code } });
  const now = new Date();
  if (!workspace)
    workspace = await db.tenant.create({
      data: {
        id: randomUUID(),
        name: '合成导入评测',
        code,
        status: 'ACTIVE',
        activatedAt: now,
        timezone: tenant.timeZone,
      },
    });
  const plan = await db.aiPlan.upsert({
    where: { name: code },
    update: { features: ['import_assist'] },
    create: {
      name: code,
      features: ['import_assist'],
      monthlyTokens: 10000000,
    },
  });
  await db.tenantAiConfig.update({
    where: { tenantId: workspace.id },
    data: { planId: plan.id },
  });
  const actors = {};
  for (const [i, m] of tenant.members.entries()) {
    const phone = '+861390000800' + i;
    const user = await db.user.upsert({
      where: { phone },
      update: {},
      create: {
        id: randomUUID(),
        phone,
        displayName: m.displayName,
        phoneVerifiedAt: now,
        passwordHash: 'fixture',
        status: 'ACTIVE',
      },
    });
    const member = await db.tenantMember.upsert({
      where: { id: m.fixtureMemberId },
      update: {},
      create: {
        id: m.fixtureMemberId,
        tenantId: workspace.id,
        userId: user.id,
        role: i === 0 ? 'TENANT_ADMIN' : 'EMPLOYEE',
        status: 'ACTIVE',
        joinedAt: now,
      },
    });
    actors[m.ref] = {
      tenantId: workspace.id,
      tenantCode: code,
      role: member.role,
      userId: user.id,
      memberId: member.id,
    };
  }
  async function object(overrides) {
    const code = 'eval' + (overrides.length ? '_' + overrides.join('_') : '');
    const found = await db.objectDefinition.findFirst({
      where: { tenantId: workspace.id, code },
    });
    if (found) return found;
    return db.$transaction(async (tx) => {
      const pubId = randomUUID(),
        obj = await tx.objectDefinition.create({
          data: {
            id: randomUUID(),
            code,
            name: '合成客户',
            titleFieldKey: 'acct_name',
            tenantId: workspace.id,
            status: 'ACTIVE',
            version: 1,
            poolEnabled: true,
            poolLifecycleEnabled: true,
          },
        });
      const fields = tenant.fields.map((f, i) => ({
        id: randomUUID(),
        fieldKey: f.fieldKey,
        label: f.label,
        type: f.type,
        required: f.required || overrides.includes(f.fieldKey),
        config: f.options ? { options: f.options } : {},
        defaultValue: null,
        validation: {},
        isSystem: f.access === 'SYSTEM',
        sortOrder: i,
      }));
      const employeeAccess = {
        canRead: true,
        canCreate: true,
        canUpdate: true,
        canDelete: false,
        canImport: true,
        readScope: 'ALL',
        updateScope: 'OWN',
        fields: Object.fromEntries(
          tenant.fields.map((f) => [
            f.fieldKey,
            f.access === 'SYSTEM' ? 'READ_ONLY' : f.access,
          ]),
        ),
      };
      const configuration = {
        publication: {
          id: pubId,
          number: 1,
          sourceDraftVersion: 1,
          publishedAt: now.toISOString(),
        },
        object: {
          id: obj.id,
          code,
          name: obj.name,
          description: null,
          titleFieldKey: 'acct_name',
          icon: null,
          sortOrder: 0,
        },
        fields,
        employeeAccess,
        defaultView: {
          code: 'default',
          name: '全部',
          columnFieldKeys: ['acct_name', 'acct_code'],
          sort: { field: 'updatedAt', direction: 'desc' },
        },
      };
      await tx.objectPublication.create({
        data: {
          id: pubId,
          tenantId: workspace.id,
          objectId: obj.id,
          publicationNo: 1,
          sourceDraftVersion: 1,
          configuration,
          changeSummary: {},
          publishedByMemberId: actors.SELF.memberId,
          publishedAt: now,
        },
      });
      await tx.objectDefinition.update({
        where: { id: obj.id },
        data: { activePublicationId: pubId, publishedAt: now },
      });
      await tx.record.create({
        data: {
          id: randomUUID(),
          tenantId: workspace.id,
          objectId: obj.id,
          recordNo: 1n,
          ownerMemberId: actors.REP_A.memberId,
          title: tenant.existing[0].acct_name,
          data: tenant.existing[0],
          source: 'MANUAL',
          version: 1,
        },
      });
      return obj;
    });
  }
  const snapshot = async () =>
    (
      await db.$queryRaw`SELECT (SELECT count(*) FROM records)::int AS records,(SELECT count(*) FROM record_import_rows)::int AS receipts,(SELECT count(*) FROM audit_logs WHERE action LIKE 'record.%')::int AS audits, (SELECT md5(string_agg(to_jsonb(o)::text,',' ORDER BY id)) FROM object_definitions o) AS objects,(SELECT md5(string_agg(configuration::text,',' ORDER BY id)) FROM object_publications) AS configurations,(SELECT md5(string_agg(features::text,',' ORDER BY id)) FROM ai_plans) AS grants`
    )[0];
  return {
    db,
    app,
    actors,
    object,
    snapshot,
    plan,
    workspace,
    records: get('modules/records/records.service', 'RecordsService'),
    schema: get(
      'modules/objects/published-object.service',
      'PublishedObjectService',
    ),
    assist(provider) {
      const { ImportAssistService } = api('modules/ai/import-assist.service');
      return new ImportAssistService(
        get('infrastructure/database/context-runner', 'DatabaseContextRunner'),
        get('modules/ai/governance/ai-ledger.service', 'AiLedgerService'),
        provider,
      );
    },
    async close() {
      await app.close();
      await db.$disconnect();
    },
  };
}
module.exports = { web, api, runtime, tenant };
