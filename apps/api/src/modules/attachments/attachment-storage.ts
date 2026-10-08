import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function attachmentStorageKey(tenantId: string, attachmentId: string) {
  if (!UUID.test(tenantId) || !UUID.test(attachmentId))
    throw new Error('Invalid attachment storage key');
  return `${tenantId}/${attachmentId}`;
}

export function attachmentStoragePath(root: string, key: string) {
  const [tenantId, attachmentId, ...rest] = key.split('/');
  if (rest.length || !tenantId || !attachmentId)
    throw new Error('Invalid attachment storage key');
  const canonicalKey = attachmentStorageKey(tenantId, attachmentId);
  const base = resolve(root);
  const path = resolve(base, canonicalKey);
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
