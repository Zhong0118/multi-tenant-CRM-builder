import type { Prisma } from '@crm/database';

export const featureCatalog = [
  {
    key: 'assistant',
    label: '对话助手',
    group: '基础',
    requires: null,
    outputLimit: 4096,
    released: true,
  },
  {
    key: 'write_proposal',
    label: 'AI 写入提议',
    group: '基础',
    requires: 'assistant',
    outputLimit: null,
    released: true,
  },
  {
    key: 'communication',
    label: '整理沟通',
    group: '数据处理',
    requires: null,
    outputLimit: 4000,
    released: true,
  },
  {
    key: 'filter',
    label: '一句话筛选',
    group: '数据处理',
    requires: null,
    outputLimit: 3500,
    released: true,
  },
  {
    key: 'table_builder',
    label: 'AI 建表',
    group: '管理员',
    requires: null,
    outputLimit: 16000,
    released: true,
  },
  {
    key: 'daily_brief',
    label: '今日建议',
    group: '销售日常',
    requires: null,
    outputLimit: 2000,
    released: false,
  },
  {
    key: 'writing',
    label: '帮我写',
    group: '销售日常',
    requires: null,
    outputLimit: 1500,
    released: false,
  },
  {
    key: 'daily_report',
    label: 'AI 写日报',
    group: '销售日常',
    requires: null,
    outputLimit: 2500,
    released: false,
  },
] as const;
export type FeatureKey = (typeof featureCatalog)[number]['key'];
export type MeteredKey = Exclude<
  (typeof featureCatalog)[number],
  { outputLimit: null }
>['key'];
export const featureKeys = featureCatalog.map((f) => f.key);
export const generationLimits = Object.fromEntries(
  featureCatalog
    .filter((f) => f.outputLimit !== null)
    .map((f) => [f.key, f.outputLimit]),
) as Record<MeteredKey, number>;

export function readCatalog(tx: Prisma.TransactionClient) {
  return tx.$queryRaw<
    {
      key: FeatureKey;
      label: string;
      group: string;
      requires: FeatureKey | null;
      purpose: string;
      released: boolean;
      outputLimit: number | null;
    }[]
  >`
    SELECT key,label,group_label AS "group",requires_key AS requires,purpose,released,output_limit AS "outputLimit"
    FROM ai_feature_catalog ORDER BY position`;
}
