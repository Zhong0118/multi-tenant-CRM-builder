import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  NotificationsQueryDto,
  ReadAllNotificationsDto,
} from './notifications.dto';

describe('notification request validation', () => {
  it.each(['100:110:101,105', '100:110:', '100:100:'])(
    'accepts snapshot %s',
    async (snapshot) => {
      expect(
        await validate(
          plainToInstance(ReadAllNotificationsDto, {
            before: '2026-10-19T00:00:00Z',
            snapshot,
          }),
        ),
      ).toHaveLength(0);
    },
  );
  it.each([
    '110:100:',
    '100:110:110',
    '100:110:99',
    '100:110:105,101',
    '0:0:',
    '1:18446744073709551616:',
    'garbage',
  ])(
    'rejects malformed snapshot %s before querying PostgreSQL',
    async (snapshot) => {
      expect(
        (
          await validate(
            plainToInstance(ReadAllNotificationsDto, {
              before: '2026-10-19T00:00:00Z',
              snapshot,
            }),
          )
        ).length,
      ).toBeGreaterThan(0);
    },
  );
  it('parses false literally and rejects unknown boolean strings', async () => {
    const query = plainToInstance(NotificationsQueryDto, {
      unreadOnly: 'false',
    });
    expect(query.unreadOnly).toBe(false);
    expect(await validate(query)).toHaveLength(0);
    expect(
      (
        await validate(
          plainToInstance(NotificationsQueryDto, { unreadOnly: 'whatever' }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});
