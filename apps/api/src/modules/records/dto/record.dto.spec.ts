import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  CreateRecordDto,
  ImportRecordsDto,
  RecordListQueryDto,
  UpdateRecordDto,
} from './record.dto';

describe('record DTOs', () => {
  it('rejects non-object dynamic values', async () => {
    const dto = Object.assign(new CreateRecordDto(), {
      values: ['not', 'object'],
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('values');
  });

  it('requires a UUID owner when one is supplied', async () => {
    const dto = Object.assign(new CreateRecordDto(), {
      values: { name: '张三' },
      ownerMemberId: 'member-1',
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('ownerMemberId');
  });

  it('requires positive record versions', async () => {
    const dto = Object.assign(new UpdateRecordDto(), {
      version: 0,
      values: { name: '张三' },
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('version');
  });

  it.each([20, 50, 100, 300, 500, 1000])(
    'accepts record-list page size %i',
    async (limit) => {
      expect(
        await validate(Object.assign(new RecordListQueryDto(), { limit })),
      ).toHaveLength(0);
    },
  );

  it('caps record-list page size at 1000', async () => {
    const dto = Object.assign(new RecordListQueryDto(), {
      page: 1,
      limit: 1001,
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('limit');
  });

  it('caps serialized dynamic filters before parsing them', async () => {
    const dto = Object.assign(new RecordListQueryDto(), {
      filters: 'x'.repeat(4001),
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain('filters');
  });
});

describe('ImportRecordsDto', () => {
  const rows = [{ rowNumber: 2, values: { name: 'Test' } }];

  it.each([
    { dryRun: 'true' },
    { matchFields: ['a', 'b', 'c', 'd'] },
    { matchFields: ['a', 'a'] },
    { matchFields: [1] },
    {
      rows: Array.from({ length: 501 }, (_, index) => ({
        rowNumber: index + 2,
        values: {},
      })),
    },
  ])('rejects invalid import options %j', async (options) => {
    expect(
      await validate(plainToInstance(ImportRecordsDto, { rows, ...options })),
    ).not.toHaveLength(0);
  });

  it('accepts preview with three mapped keys and the 500 row boundary', async () => {
    const input = {
      dryRun: true,
      matchFields: ['a', 'b', 'c'],
      rows: Array.from({ length: 500 }, (_, index) => ({
        rowNumber: index + 2,
        values: { a: 'x', b: 0, c: false },
      })),
    };
    expect(
      await validate(plainToInstance(ImportRecordsDto, input)),
    ).toHaveLength(0);
  });
});
