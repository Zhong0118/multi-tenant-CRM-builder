import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { ApiException } from '../../common/errors/api.exception';
import type { AuthenticatedUser } from '../../common/tenancy/tenant-context';
import { avatarUrl, encodeAvatar } from './avatar-codec';
import { appendAccountAudit } from './account-audit';
import { setTenant, setUser, type ProfileMeta } from './users.service';

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const isMissing = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && e.code === 'ENOENT';

@Injectable()
export class AvatarService implements OnModuleInit {
  private readonly logger = new Logger(AvatarService.name);
  private readonly root: string;
  constructor(
    private readonly db: DatabaseService,
    config: ConfigService,
  ) {
    this.root = config.get<string>(
      'AVATARS_STORAGE_DIR',
      '/var/lib/crm/avatars',
    );
  }
  async onModuleInit() {
    const dirs = await readdir(this.root, { withFileTypes: true }).catch(
      (e: unknown) => {
        if (isMissing(e)) return [];
        throw e;
      },
    );
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const dir of dirs) {
      if (!dir.isDirectory() || !uuid.test(dir.name)) continue;
      const path = join(this.root, dir.name);
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        const [version, ext, ...rest] = entry.name.split('.');
        if (
          !entry.isFile() ||
          rest.length ||
          !uuid.test(version) ||
          !['tmp', 'webp'].includes(ext)
        )
          continue;
        const file = join(path, entry.name);
        const info = await stat(file).catch((e: unknown) => {
          if (isMissing(e)) return null;
          throw e;
        });
        if (!info || info.mtimeMs >= cutoff) continue;
        const live =
          ext === 'webp' &&
          (await this.db.client.user.count({
            where: { id: dir.name, avatarVersion: version },
          }));
        if (!live) await rm(file, { force: true });
      }
    }
  }
  private async discard(path: string) {
    await rm(path, { force: true }).catch(() =>
      this.logger.warn('头像文件未能删除，将在启动清理时重试'),
    );
  }
  async replace(userId: string, input: Buffer | null, meta: ProfileMeta) {
    const dir = join(this.root, userId);
    const version = input ? randomUUID() : null;
    const path = version ? join(dir, version + '.webp') : null;
    if (input && path) {
      const encoded = await encodeAvatar(input);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const temp = join(dir, version + '.tmp');
      try {
        await writeFile(temp, encoded, { mode: 0o600, flag: 'wx' });
        await rename(temp, path);
      } finally {
        await this.discard(temp);
      }
    }
    let previous: string | null;
    try {
      previous = await this.db.transaction(async (tx) => {
        await setUser(tx, userId);
        const [user] = await tx.$queryRaw<
          { avatar_version: string | null }[]
        >`SELECT avatar_version FROM users WHERE id=${userId}::uuid FOR UPDATE`;
        if (!user) throw new NotFoundException();
        await tx.user.update({
          where: { id: userId },
          data: { avatarVersion: version },
        });
        await appendAccountAudit(tx, userId, 'account.avatar_changed', meta, {
          hasAvatar: version !== null,
        });
        return user.avatar_version;
      });
    } catch (e) {
      // If the connection broke during commit, let startup cleanup resolve an uncertain outcome.
      if (
        path &&
        (await this.db.client.user
          .count({ where: { id: userId, avatarVersion: version } })
          .catch(() => 1)) === 0
      )
        await this.discard(path);
      throw e;
    }
    if (previous) await this.discard(join(dir, previous + '.webp'));
    return { avatarUrl: avatarUrl(userId, version) };
  }
  async read(viewer: AuthenticatedUser, userId: string, version: string) {
    const current = await this.db.transaction(async (tx) => {
      await setUser(tx, viewer.id);
      if (viewer.id !== userId && !viewer.isPlatformAdmin) {
        const own = await tx.tenantMember.findMany({
          where: {
            userId: viewer.id,
            status: 'ACTIVE',
            user: { status: 'ACTIVE' },
            tenant: { status: 'ACTIVE' },
          },
          select: { tenantId: true },
        });
        let shared = false;
        for (const { tenantId } of own) {
          await setTenant(tx, tenantId);
          const same = await tx.tenantMember.count({
            where: {
              tenantId,
              status: 'ACTIVE',
              userId,
              user: { status: 'ACTIVE' },
              tenant: {
                status: 'ACTIVE',
                members: {
                  some: {
                    userId: viewer.id,
                    status: 'ACTIVE',
                    user: { status: 'ACTIVE' },
                  },
                },
              },
            },
          });
          if (same) {
            shared = true;
            break;
          }
        }
        if (!shared) throw new ApiException('WORKSPACE_FORBIDDEN', 403);
      }
      return tx.user.findUnique({
        where: { id: userId },
        select: { avatarVersion: true },
      });
    });
    if (current?.avatarVersion !== version) throw new NotFoundException();
    try {
      return await readFile(join(this.root, userId, version + '.webp'));
    } catch (e) {
      if (isMissing(e)) throw new NotFoundException();
      throw e;
    }
  }
}
