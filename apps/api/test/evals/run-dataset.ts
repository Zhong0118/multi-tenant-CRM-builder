import { ApiException } from '../../src/common/errors/api.exception';

/** Run sequentially so each sample has an independent output and score. */
export async function runDataset<S, D>(
  samples: readonly S[],
  generate: (sample: S) => Promise<D>,
  score: (sample: S, draft: D) => string[],
  trace?: () => unknown,
) {
  const rows = [];
  for (const sample of samples) {
    let draft: D | null = null;
    let failures: string[];
    try {
      draft = await generate(sample);
      failures = score(sample, draft);
    } catch (error) {
      failures = [
        error instanceof ApiException ? error.code : 'EVAL_RUN_ERROR',
      ];
    }
    rows.push({ sample, draft, failures, modelOutput: trace?.() ?? null });
  }
  return rows;
}
