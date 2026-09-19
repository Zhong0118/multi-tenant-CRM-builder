import { AiSanitizer } from './ai-sanitizer';

describe('AiSanitizer.sanitizeToolResult', () => {
  it('truncates individual string values to 2000 Unicode code points', () => {
    const long = '你'.repeat(2005);
    const result = AiSanitizer.sanitizeToolResult({ note: long });
    expect(typeof result).toBe('object');
    expect((result as { note: string }).note).toBe('你'.repeat(2000));
    expect([...(result as { note: string }).note].length).toBe(2000);
  });

  it('keeps only plain JSON-safe values and drops functions, undefined, bigint, and NaN', () => {
    const result = AiSanitizer.sanitizeToolResult({
      ok: true,
      count: 2,
      empty: null,
      nested: { title: '线索' },
      skip: undefined,
      fn: () => 'nope',
      big: 1n,
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
    });
    expect(result).toEqual({
      ok: true,
      count: 2,
      empty: null,
      nested: { title: '线索' },
    });
  });

  it('strips secret-like keys including nested tokenHash, passwordHash, session, cookie, and apiKey', () => {
    const result = AiSanitizer.sanitizeToolResult({
      title: '可见',
      tokenHash: 'abc',
      passwordHash: 'hash',
      session: { id: 's' },
      cookie: 'crm_session=x',
      apiKey: 'sk-live',
      values: {
        name: '客户',
        apiKey: 'nested-secret',
        note: '备注',
      },
    });
    expect(result).toEqual({
      title: '可见',
      values: { name: '客户', note: '备注' },
    });
    expect(JSON.stringify(result)).not.toMatch(/tokenHash|passwordHash|sk-live|crm_session/);
  });

  it('does not change ActorContext-shaped objects that are not themselves the payload keys', () => {
    const result = AiSanitizer.sanitizeToolResult({
      items: [{ id: '1', title: '自己的线索', values: { name: '自己的线索' } }],
    });
    expect(result).toEqual({
      items: [{ id: '1', title: '自己的线索', values: { name: '自己的线索' } }],
    });
  });
});
