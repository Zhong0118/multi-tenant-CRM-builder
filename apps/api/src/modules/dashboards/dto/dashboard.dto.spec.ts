import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PreviewDashboardDto } from './dashboard.dto';

describe('PreviewDashboardDto', () => {
  it('does not accept browser timezone as preview input semantics', async () => {
    const dto = plainToInstance(PreviewDashboardDto, {
      expectedVersion: 1,
      period: {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
        timezone: 'Europe/London',
      },
    });

    await expect(validate(dto, { whitelist: true })).resolves.toEqual([]);
    expect(dto.period).toEqual({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
    });
  });
});
