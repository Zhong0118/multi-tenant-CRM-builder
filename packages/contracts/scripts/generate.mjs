import { mkdir, writeFile } from "node:fs/promises";

import openapiTS, { astToString, COMMENT_HEADER } from "openapi-typescript";

const input = new URL("../openapi.json", import.meta.url);
const output = new URL("../src/generated/openapi.ts", import.meta.url);
const nodes = await openapiTS(input, { alphabetize: true });

await mkdir(new URL("../src/generated/", import.meta.url), { recursive: true });
await writeFile(output, `${COMMENT_HEADER}${astToString(nodes)}`);
