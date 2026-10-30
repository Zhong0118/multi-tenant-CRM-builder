import {
  decryptSecret,
  encryptSecret,
  normalizePhone,
  KuaimaProvider,
  safeRecordingUrl,
} from './telephony-provider';

describe('telephony provider boundary', () => {
  const key = 'ab'.repeat(32);
  it('only accepts explicit mainland mobile format', () => {
    expect(normalizePhone('+8613812345678')).toBe('13812345678');
    expect(normalizePhone('13912345678')).toBe('13912345678');
    for (const value of [
      '0013812345678',
      '+12125551234',
      '138 1234 5678',
      '',
      '10086',
    ])
      expect(() => normalizePhone(value)).toThrow();
  });
  it('encrypts with authenticated randomized AES and requires a stable 32-byte key', () => {
    const ciphertext = encryptSecret('secret', key);
    expect(ciphertext).not.toContain('secret');
    expect(encryptSecret('secret', key)).not.toBe(ciphertext);
    expect(decryptSecret(ciphertext, key)).toBe('secret');
    expect(() => decryptSecret(ciphertext, 'cd'.repeat(32))).toThrow();
    expect(() => encryptSecret('secret', '')).toThrow();
  });
  it('allows public HTTPS recording links only', () => {
    expect(safeRecordingUrl('https://audio.example.com/call.mp3')).toBe(
      'https://audio.example.com/call.mp3',
    );
    for (const value of [
      'http://audio.example.com/a',
      'https://127.0.0.1/a',
      'https://user:pass@example.com/a',
      'javascript:alert(1)',
      'https://10.0.0.1/a',
      'https://localhost/a',
      'https://[::1]/a',
    ])
      expect(() => safeRecordingUrl(value)).toThrow();
  });
  it('sends the documented fixed URL and form with uppercase MD5, and accepts only code 1 plus bind_id', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    const transport: typeof fetch = (url, options) => {
      capturedUrl =
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      capturedBody =
        options?.body instanceof URLSearchParams ? options.body.toString() : '';
      return Promise.resolve(
        new Response(JSON.stringify({ code: 1, bind_id: 'vendor-id' })),
      );
    };
    const result = await new KuaimaProvider().dial(
      {
        companyId: 'company',
        appSecret: 'secret',
        caller: '13911113002',
        callee: '13812345678',
      },
      transport,
      1700000000,
    );
    expect(result).toEqual({ status: 'ACCEPTED', providerBindId: 'vendor-id' });
    expect(capturedUrl).toBe('https://www.kuaimatongxun.com/api/call/callBind');
    expect(Object.fromEntries(new URLSearchParams(capturedBody))).toEqual({
      company_id: 'company',
      ts: '1700000000',
      sign: '196DAF7131E05360F6D6F068DD7A8244',
      api_type: 'companyapi',
      type: '2',
      caller: '13911113002',
      callee: '13812345678',
    });
    expect(
      await new KuaimaProvider().dial(
        {
          companyId: 'a',
          appSecret: 'b',
          caller: '13911113002',
          callee: '13812345678',
        },
        () => Promise.resolve(new Response('{"code":1}')),
      ),
    ).toEqual({ status: 'UNKNOWN', providerBindId: null });
  });
  it('treats ambiguous response or timeout as UNKNOWN without retrying', async () => {
    let attempts = 0;
    const result = await new KuaimaProvider().dial(
      {
        companyId: 'a',
        appSecret: 'b',
        caller: '13911113002',
        callee: '13812345678',
      },
      () => {
        attempts++;
        throw new Error('network secret body');
      },
    );
    expect(result).toEqual({ status: 'UNKNOWN', providerBindId: null });
    expect(attempts).toBe(1);
  });
  it('keeps malformed response outcomes uncertain and treats only explicit numeric rejection as FAILED', async () => {
    const input = {
      companyId: 'a',
      appSecret: 'b',
      caller: '13911113002',
      callee: '13812345678',
    };
    for (const payload of [
      { code: 'garbage' },
      {},
      { code: 1, bind_id: '  ' },
    ]) {
      expect(
        await new KuaimaProvider().dial(input, () =>
          Promise.resolve(new Response(JSON.stringify(payload))),
        ),
      ).toEqual({ status: 'UNKNOWN', providerBindId: null });
    }
    expect(
      await new KuaimaProvider().dial(input, () =>
        Promise.resolve(
          new Response('{"code":0,"msg":"secret vendor details"}'),
        ),
      ),
    ).toEqual({ status: 'FAILED', providerBindId: null });
  });
});
