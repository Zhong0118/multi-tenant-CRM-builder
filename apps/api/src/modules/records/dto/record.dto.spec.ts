import { validate } from 'class-validator';

import {
  CreateRecordDto,
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

  it('caps record-list page size at 100', async () => {
    const dto = Object.assign(new RecordListQueryDto(), {
      page: 1,
      limit: 101,
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
