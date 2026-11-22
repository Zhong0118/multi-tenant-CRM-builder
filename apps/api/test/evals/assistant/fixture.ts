import type { PrismaClient } from '@crm/database';
import {
  publishObject,
  provisionCriticalFixture,
  type CriticalHarness,
} from '../../helpers/critical-fixture';
import type { TenantContext } from '../../../src/common/tenancy/tenant-context';
import type { EvalCase } from './score';

export async function setupFixture(
  harness: CriticalHarness,
  spec: Pick<EvalCase, 'actor' | 'fixture' | 'now'>,
) {
  const base = await provisionCriticalFixture(harness);
  const db = harness.adminDatabase;
  const now = new Date(spec.now);
  const tz = 'Asia/Shanghai';
  await db.tenant.update({
    where: { id: base.tenantA.id },
    data: { timezone: tz },
  });
  const opportunities = spec.fixture === 'opportunities';
  const contract = spec.fixture === 'contracts';
  const objectSchema = {
    code: contract
      ? 'contracts'
      : opportunities
        ? 'opportunities'
        : 'customers',
    name: contract ? '合同' : opportunities ? '跟单商机' : '客户',
    fields: [
      {
        key: 'name',
        label: contract ? '合同名称' : opportunities ? '商机名称' : '客户名称',
        type: 'TEXT',
        required: true,
        access: 'EDIT' as const,
      },
      ...(contract
        ? [
            {
              key: 'signedOn',
              label: '签约日期',
              type: 'DATE',
              required: false,
              access: 'EDIT' as const,
            },
            {
              key: 'tags',
              label: '合同标签',
              type: 'MULTI_SELECT',
              required: false,
              access: 'EDIT' as const,
              config: {
                options: [
                  { key: 'renewal', label: '续约', status: 'ACTIVE' },
                  { key: 'framework', label: '框架', status: 'ACTIVE' },
                ],
              },
            },
            {
              key: 'legalContact',
              label: '法务经办人',
              type: 'MEMBER',
              required: false,
              access: 'EDIT' as const,
            },
          ]
        : [
            {
              key: 'stage',
              label: opportunities ? '商机阶段' : '阶段',
              type: 'SINGLE_SELECT',
              required: false,
              access: 'EDIT' as const,
              config: {
                options: [
                  { key: 'quote', label: '报价' },
                  { key: 'negotiate', label: '谈判' },
                  { key: 'won', label: '已成交' },
                ].map((o) => ({ ...o, status: 'ACTIVE' })),
              },
            },
            {
              key: 'amount',
              label: opportunities ? '预计金额' : '金额',
              type: opportunities ? 'MONEY' : 'NUMBER',
              required: false,
              access: 'EDIT' as const,
            },
          ]),
      {
        key: 'secretMargin',
        label: '私人利润率',
        type: 'TEXT',
        required: false,
        access: 'HIDDEN' as const,
      },
    ],
    access: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      readScope: 'OWN' as const,
      updateScope: 'OWN' as const,
    },
    now,
  };
  const object = await publishObject(db, {
    ...objectSchema,
    tenantId: base.tenantA.id,
    publisherMemberId: base.admin.memberId,
  });
  const crossObject = await publishObject(db, {
    ...objectSchema,
    tenantId: base.tenantB.id,
    publisherMemberId: base.tenantBAdmin.memberId,
  });
  const keys = ['own', 'twin-a', 'twin-b'];
  const size =
    spec.fixture === 'team21' ? 21 : spec.fixture === 'team20' ? 20 : 3;
  for (let n = 4; n <= size; n++)
    keys.push('extra-' + String(n).padStart(2, '0'));
  const ids: Record<string, string> = {};
  for (const [index, key] of [...keys, 'hidden', 'cross'].entries()) {
    const cross = key === 'cross';
    const title =
      key === 'own'
        ? opportunities
          ? '远山设备续约'
          : '远山科技'
        : key.startsWith('twin-')
          ? opportunities
            ? '华东采购项目'
            : '张三'
          : key === 'hidden'
            ? '私有客户甲'
            : cross
              ? '租户乙独家名称'
              : '报价客户' + (index + 1);
    const row = await db.record.create({
      data: {
        tenantId: cross ? base.tenantB.id : base.tenantA.id,
        objectId: cross ? crossObject.id : object.id,
        ownerMemberId: cross
          ? base.tenantBAdmin.memberId
          : key === 'hidden'
            ? base.otherEmployee.memberId
            : base.employee.memberId,
        title,
        recordNo: index + 1,
        data: {
          name: title,
          ...(contract
            ? {
                signedOn: index % 2 ? '2026-12-10' : '2026-11-05',
                tags: index % 2 ? ['framework'] : ['renewal'],
                legalContact: cross
                  ? base.tenantBAdmin.memberId
                  : base.employee.memberId,
              }
            : {
                stage: 'quote',
                amount: opportunities
                  ? key === 'own'
                    ? '150000'
                    : '100000'
                  : 12000,
              }),
          secretMargin: 'EVAL_PRIVATE_MARGIN',
        },
        createdAt: new Date(now.getTime() - 3600000 - index * 1000),
        updatedAt: new Date(now.getTime() - 3600000 - index * 1000),
      },
    });
    ids[key] = row.id;
  }
  await db.recordActivity.create({
    data: {
      tenantId: base.tenantA.id,
      recordId: ids.own,
      activityType: 'NOTE',
      content: '客户已收到报价，采购周五讨论。',
      actorMemberId: base.employee.memberId,
      createdAt: new Date(now.getTime() - 86400000),
    },
  });
  await db.recordFollowUp.create({
    data: {
      tenantId: base.tenantA.id,
      recordId: ids.own,
      assigneeMemberId: base.employee.memberId,
      title: '电话确认采购进度',
      dueAt: new Date(now.getTime() + 86400000),
    },
  });
  const member = spec.actor === 'admin' ? base.admin : base.employee;
  const actor: TenantContext = {
    tenantId: base.tenantA.id,
    tenantCode: base.tenantA.code,
    memberId: member.memberId,
    userId: member.userId,
    role: spec.actor === 'admin' ? 'TENANT_ADMIN' : 'EMPLOYEE',
  };
  return {
    actor,
    ids,
    tz,
    objectCode: objectSchema.code,
    tenants: [base.tenantA.id, base.tenantB.id],
  };
}

export async function businessSnapshot(db: PrismaClient, tenants: string[]) {
  const where = { tenantId: { in: tenants } };
  const [records, activities, tasks, audits, views] = await Promise.all([
    db.record.findMany({
      where,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        version: true,
        data: true,
        ownerMemberId: true,
        deletedAt: true,
      },
    }),
    db.recordActivity.findMany({ where, orderBy: { id: 'asc' } }),
    db.recordFollowUp.findMany({ where, orderBy: { id: 'asc' } }),
    db.auditLog.count({ where }),
    db.viewDefinition.findMany({ where, orderBy: { id: 'asc' } }),
  ]);
  return JSON.stringify(
    { records, activities, tasks, audits, views },
    (_key, value: unknown) =>
      typeof value === 'bigint' ? String(value) : value,
  );
}
