import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { Test } from '@nestjs/testing';
import { ApiException } from '../../../src/common/errors/api.exception';
import {
  AI_PROVIDER,
  createAiProvider,
  type AiProvider,
} from '../../../src/modules/ai/ai-provider';
import { CommunicationDraftGenerator } from '../../../src/modules/ai/communication-draft-generator';
import { FollowUpsService } from '../../../src/modules/follow-ups/follow-ups.service';
import { PublishedObjectService } from '../../../src/modules/objects/published-object.service';
import { RECORDS_REPOSITORY } from '../../../src/modules/records/records.service';
import { cases, type EvalCase } from './cases';
import { score } from './score';
import { providerSettings, renderReport, type CaseResult } from './report';

const actor = {
  userId: 'eval-user',
  tenantId: 'eval-company',
  tenantCode: 'eval',
  memberId: 'eval-employee',
  role: 'EMPLOYEE',
} as const;

// The samples supply the already permission-trimmed context that generate() receives.
// Neither the real nor the fake run reads a CRM database or confirms a proposal.
export async function evaluate(
  provider: AiProvider,
  samples: EvalCase[],
): Promise<CaseResult[]> {
  let modelOutput: unknown = null;
  const module = await Test.createTestingModule({
    providers: [
      CommunicationDraftGenerator,
      { provide: PublishedObjectService, useValue: {} },
      { provide: FollowUpsService, useValue: {} },
      {
        provide: RECORDS_REPOSITORY,
        useValue: {
          // The synthetic tenant has no assignable members.
          withTenant: (
            _actor: unknown,
            work: (store: { memberExists: () => Promise<boolean> }) => unknown,
          ) => work({ memberExists: () => Promise.resolve(false) }),
        },
      },
      {
        provide: AI_PROVIDER,
        useValue: {
          generateCommunication: async (
            ...args: Parameters<
              NonNullable<AiProvider['generateCommunication']>
            >
          ) => {
            const raw = await provider.generateCommunication!(...args);
            if (!args[1].aborted) modelOutput = raw;
            return raw;
          },
        },
      },
    ],
  }).compile();
  const rows: CaseResult[] = [];
  try {
    const generator = module.get(CommunicationDraftGenerator);
    for (const sample of samples) {
      modelOutput = null;
      const row: CaseResult = {
        id: sample.id,
        category: sample.category,
        text: sample.text,
        expected: sample.expected,
        modelOutput: null,
        draft: null,
        failures: [],
      };
      try {
        row.draft = await generator.generate(
          {
            actor,
            objectId: 'eval-object',
            publicationId: 'eval-publication',
            recordId: sample.id,
            expectedVersion: 1,
            now: sample.now,
            timeZone: sample.timeZone,
            fields: sample.fields,
            visibleFieldKeys: sample.fields.map((f) => f.fieldKey),
            recordContext: sample.recordContext,
          },
          sample.text,
        );
        row.failures = score(sample, row.draft);
      } catch (err) {
        // SDK errors may contain headers or request bodies. Publish only stable API codes.
        row.failures = [
          err instanceof ApiException ? err.code : 'EVAL_RUN_ERROR',
        ];
      }
      row.modelOutput = modelOutput;
      rows.push(row);
    }
    return rows;
  } finally {
    await module.close();
  }
}

async function main() {
  const { values } = parseArgs({
    options: { report: { type: 'string' }, strict: { type: 'boolean' } },
  });
  let settings;
  try {
    settings = providerSettings(process.env);
  } catch (error) {
    // providerSettings throws fixed configuration hints which contain only variable names.
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }
  const provider = createAiProvider(settings);
  const rows = await evaluate(provider, cases);
  const report = renderReport(
    `${provider.providerKey} / ${provider.modelKey}`,
    rows,
    process.env.AI_API_KEY,
  );
  if (values.report) {
    await writeFile(values.report, report, { mode: 0o600 });
    console.log(
      `通过 ${rows.filter((r) => !r.failures.length).length}/${rows.length}，完整报告已写入指定文件。`,
    );
  } else {
    process.stdout.write(report + '\n');
  }
  if (rows.some((r) => !r.draft || (values.strict && r.failures.length)))
    process.exitCode = 1;
}

if (require.main === module) {
  void main().catch(() => {
    console.error('评测未完成，请检查参数和报告目录。');
    process.exitCode = 1;
  });
}
