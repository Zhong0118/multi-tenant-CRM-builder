import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AttachmentsRepository } from './attachments.repository';
import {
  attachmentStorageKey,
  attachmentStoragePath,
} from './attachment-storage';
import type { TenantContext } from '../../common/tenancy/tenant-context';

const tenantId = '0198ad18-a74d-7b69-b81a-49a74f9a3e0d';
const memberId = '0198ad18-a74d-7b69-b81a-49a74f9a3e0e';
const userId = '0198ad18-a74d-7b69-b81a-49a74f9a3e0f';
const objectId = '0198ad18-a74d-7b69-b81a-49a74f9a3e10';
const recordId = '0198ad18-a74d-7b69-b81a-49a74f9a3e11';
const attachmentId = '0198ad18-a74d-7b69-b81a-49a74f9a3e12';

const context: TenantContext = {
  userId,
  tenantId,
  tenantCode: 'tenant-a',
  memberId,
  role: 'TENANT_ADMIN',
};
const scope = { objectId, recordId };
const meta = { requestId: 'request-1' };

function sqlText(strings: TemplateStringsArray | readonly string[]) {
  return Array.from(strings).join(' ');
}

function transactionFor(options: {
  attachment?: { storageKey?: string; content?: Buffer };
  commitError?: Error;
  auditError?: Error;
  executeCount?: number;
}) {
  const tx = {
    $queryRaw: jest.fn((strings: TemplateStringsArray | readonly string[]) => {
      const sql = sqlText(strings);
      if (sql.includes('FROM tenant_members'))
        return Promise.resolve([{ role: 'TENANT_ADMIN' }]);
      if (sql.includes('FROM records'))
        return Promise.resolve([{ id: recordId }]);
      if (sql.includes('count(*)'))
        return Promise.resolve([{ count: 0, bytes: 0 }]);
      if (sql.includes('INSERT INTO record_attachments'))
        return Promise.resolve([
          {
            id: attachmentId,
            filename: 'note.txt',
            byteSize: 6,
            createdAt: new Date(),
          },
        ]);
      if (sql.includes('storage_key AS'))
        return Promise.resolve(
          options.attachment
            ? [
                {
                  id: attachmentId,
                  filename: 'note.txt',
                  byteSize: 6,
                  createdAt: new Date(),
                  content: options.attachment.content,
                  storageKey: options.attachment.storageKey,
                },
              ]
            : [],
        );
      return Promise.resolve([]);
    }),
    $executeRaw: jest.fn(() => Promise.resolve(options.executeCount ?? 1)),
  };
  const audit = {
    append: jest.fn(async () => {
      if (options.auditError) throw options.auditError;
    }),
  };
  const runner = {
    withTenant: jest.fn(
      async (
        _context: TenantContext,
        work: (transaction: typeof tx) => Promise<unknown>,
      ) => {
        const result = await work(tx);
        if (options.commitError) throw options.commitError;
        return result;
      },
    ),
  };
  return { tx, audit, runner };
}

async function withStorage<T>(callback: (root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), 'crm-attachment-repository-'));
  const previous = process.env.ATTACHMENTS_STORAGE_DIR;
  process.env.ATTACHMENTS_STORAGE_DIR = root;
  try {
    return await callback(root);
  } finally {
    if (previous === undefined) delete process.env.ATTACHMENTS_STORAGE_DIR;
    else process.env.ATTACHMENTS_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

describe('AttachmentsRepository', () => {
  it('removes a staged disk file when the transaction callback rolls back', async () => {
    await withStorage(async (root) => {
      const fake = transactionFor({ auditError: new Error('audit failed') });
      const repository = new AttachmentsRepository(
        fake.runner as never,
        fake.audit as never,
      );
      await expect(
        repository.create(
          context,
          scope,
          'note.txt',
          Buffer.from('secret'),
          meta,
        ),
      ).rejects.toThrow('audit failed');
      await expect(readdir(join(root, tenantId))).resolves.toEqual([]);
    });
  });

  it('removes a staged disk file when transaction commit rejects', async () => {
    await withStorage(async (root) => {
      const fake = transactionFor({ commitError: new Error('commit failed') });
      const repository = new AttachmentsRepository(
        fake.runner as never,
        fake.audit as never,
      );
      await expect(
        repository.create(
          context,
          scope,
          'note.txt',
          Buffer.from('secret'),
          meta,
        ),
      ).rejects.toThrow('commit failed');
      await expect(readdir(join(root, tenantId))).resolves.toEqual([]);
    });
  });

  it('reads disk-backed attachments and legacy inline attachments', async () => {
    await withStorage(async (root) => {
      const diskKey = attachmentStorageKey(tenantId, attachmentId);
      const diskPath = attachmentStoragePath(root, diskKey);
      await mkdir(join(root, tenantId), { recursive: true });
      await writeFile(diskPath, Buffer.from('disk'));
      const disk = transactionFor({ attachment: { storageKey: diskKey } });
      const diskRepository = new AttachmentsRepository(
        disk.runner as never,
        disk.audit as never,
      );
      await expect(
        diskRepository.download(context, scope, attachmentId),
      ).resolves.toMatchObject({ content: Buffer.from('disk') });

      const legacy = transactionFor({
        attachment: { content: Buffer.from('legacy') },
      });
      const legacyRepository = new AttachmentsRepository(
        legacy.runner as never,
        legacy.audit as never,
      );
      await expect(
        legacyRepository.download(context, scope, attachmentId),
      ).resolves.toMatchObject({ content: Buffer.from('legacy') });
    });
  });

  it('returns not found when a disk-backed file is missing', async () => {
    await withStorage(async () => {
      const fake = transactionFor({
        attachment: {
          storageKey: attachmentStorageKey(tenantId, attachmentId),
        },
      });
      const repository = new AttachmentsRepository(
        fake.runner as never,
        fake.audit as never,
      );
      await expect(
        repository.download(context, scope, attachmentId),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  it('retains the file when delete transaction rolls back', async () => {
    await withStorage(async (root) => {
      const key = attachmentStorageKey(tenantId, attachmentId);
      const path = attachmentStoragePath(root, key);
      await mkdir(join(root, tenantId), { recursive: true });
      await writeFile(path, Buffer.from('delete me'));
      const fake = transactionFor({
        attachment: { storageKey: key },
        auditError: new Error('rollback'),
      });
      const repository = new AttachmentsRepository(
        fake.runner as never,
        fake.audit as never,
      );
      await expect(
        repository.remove(context, scope, attachmentId, meta),
      ).rejects.toThrow('rollback');
      await expect(readFile(path)).resolves.toEqual(Buffer.from('delete me'));
    });
  });

  it('removes the file after a successful delete transaction', async () => {
    await withStorage(async (root) => {
      const key = attachmentStorageKey(tenantId, attachmentId);
      const path = attachmentStoragePath(root, key);
      await mkdir(join(root, tenantId), { recursive: true });
      await writeFile(path, Buffer.from('delete me'));
      const fake = transactionFor({ attachment: { storageKey: key } });
      const repository = new AttachmentsRepository(
        fake.runner as never,
        fake.audit as never,
      );
      await repository.remove(context, scope, attachmentId, meta);
      await expect(readFile(path)).rejects.toThrow();
    });
  });
});
