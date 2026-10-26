import { Logger } from '@nestjs/common';
import type { DatabaseService } from '../../infrastructure/database/database.service';
import { NotificationScheduler } from './notification-scheduler';

describe('NotificationScheduler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('generates reminders without page requests, prevents overlap and stops its timer', async () => {
    let finish!: (value: unknown[]) => void;
    const query = jest.fn(
      () =>
        new Promise<unknown[]>((resolve) => {
          finish = resolve;
        }),
    );
    const database = {
      transaction: (work: (tx: unknown) => unknown) =>
        work({ $queryRaw: query }),
    } as unknown as DatabaseService;
    const scheduler = new NotificationScheduler(database);
    scheduler.onModuleInit();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith([
      expect.stringMatching(
        /sweep_member_notifications.*sweep_work_goal_notifications/,
      ),
    ]);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(query).toHaveBeenCalledTimes(1);
    finish([{ count: 1 }]);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(query).toHaveBeenCalledTimes(2);
    scheduler.onModuleDestroy();
    finish([{ count: 0 }]);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('logs a failed sweep and retries on the next interval', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const query = jest
      .fn()
      .mockRejectedValueOnce(new Error('database offline'))
      .mockResolvedValue([{ count: 0 }]);
    const database = {
      transaction: (work: (tx: unknown) => unknown) =>
        work({ $queryRaw: query }),
    } as unknown as DatabaseService;
    const scheduler = new NotificationScheduler(database);
    scheduler.onModuleInit();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(query).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalled();
    scheduler.onModuleDestroy();
    log.mockRestore();
  });
});
