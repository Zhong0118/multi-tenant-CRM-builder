import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { createApp, createOpenApiDocument } from '../bootstrap';

async function generate(): Promise<void> {
  const app = await createApp();
  try {
    const outputPath = resolve(
      __dirname,
      '../../../../packages/contracts/openapi.json',
    );
    const document = sortObject(createOpenApiDocument(app));
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, sortObject(child)]),
  );
}

void generate();
