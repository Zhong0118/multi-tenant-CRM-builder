import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export function attachmentStorageKey(tenantId: string, attachmentId: string) {
  return `${tenantId}/${attachmentId}`;
}

export function attachmentStoragePath(root: string, key: string) {
  const base = resolve(root);
  const path = resolve(base, key);
  if (path !== base && !path.startsWith(`${base}${sep}`))
    throw new Error('Invalid attachment storage key');
  return path;
}

export async function writeAttachmentFile(
  root: string,
  key: string,
  content: Buffer,
) {
  const path = attachmentStoragePath(root, key);
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
}
