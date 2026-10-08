import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  attachmentStorageKey,
  attachmentStoragePath,
  writeAttachmentFile,
} from './attachment-storage';

describe('private attachment storage', () => {
  it('uses tenant-separated UUID keys and prevents path traversal', () => {
    const tenantId = '0198ad18-a74d-7b69-b81a-49a74f9a3e0d';
    const attachmentId = '0198ad18-a74d-7b69-b81a-49a74f9a3e0e';
    const key = attachmentStorageKey(tenantId, attachmentId);
    expect(key).toBe(`${tenantId}/${attachmentId}`);
    expect(attachmentStoragePath('/srv/attachments', key)).toBe(
      `/srv/attachments/${tenantId}/${attachmentId}`,
    );
    expect(() => attachmentStorageKey('tenant-a', attachmentId)).toThrow();
    expect(() =>
      attachmentStoragePath('/srv/attachments', '../secret'),
    ).toThrow();
  });

  it('writes private files atomically with restrictive permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crm-attachments-'));
    try {
      const key = attachmentStorageKey(
        '0198ad18-a74d-7b69-b81a-49a74f9a3e0d',
        '0198ad18-a74d-7b69-b81a-49a74f9a3e0e',
      );
      await writeAttachmentFile(root, key, Buffer.from('secret'));
      await expect(readFile(attachmentStoragePath(root, key))).resolves.toEqual(
        Buffer.from('secret'),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
