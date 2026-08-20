import { normalizeChineseMobile } from './phone-number';

describe('normalizeChineseMobile', () => {
  it('normalizes supported Chinese mainland mobile formats to E.164', () => {
    expect(normalizeChineseMobile('13800138000')).toBe('+8613800138000');
    expect(normalizeChineseMobile('+86 138 0013 8000')).toBe('+8613800138000');
  });

  it('rejects numbers outside the supported mobile range', () => {
    expect(() => normalizeChineseMobile('01012345678')).toThrow(
      'INVALID_PHONE',
    );
  });
});
