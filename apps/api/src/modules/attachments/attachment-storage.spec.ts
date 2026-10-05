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
    const key = attachmentStorageKey('tenant-a', 'attachment-b');
    expect(key).toBe('tenant-a/attachment-b');
    expect(attachmentStoragePath('/srv/attachments', key)).toBe(
      '/srv/attachments/tenant-a/attachment-b',
    );
    expect(() => attachmentStoragePath('/srv/attachments', '../secret')).toThrow();
  });

  it('writes private files atomically with restrictive permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crm-attachments-'));
    try {
      const key = attachmentStorageKey('tenant-a', 'attachment-b');
      await writeAttachmentFile(root, key, Buffer.from('secret'));
      await expect(readFile(attachmentStoragePath(root, key))).resolves.toEqual(
        Buffer.from('secret'),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
