import {
  normalizePhone,
  KuaimaProvider,
  safeRecordingUrl,
  TelephonyVault,
} from './telephony-provider';

const keyring = (id: string, byte: string) =>
  JSON.stringify({
    activeKeyId: id,
    keys: { [id]: Buffer.alloc(32, byte).toString('base64') },
  });

describe('telephony provider boundary', () => {
  const tenant = '11111111-1111-4111-8111-111111111111';
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
  it('seals secrets with the keyring, bound to the tenant and the secret kind', () => {
    const vault = new TelephonyVault(() => keyring('k1', 'a'));
    const sealed = vault.seal(tenant, 'appSecret', 'secret');
    expect(sealed).not.toContain('secret');
    expect(vault.seal(tenant, 'appSecret', 'secret')).not.toBe(sealed);
    expect(vault.open(tenant, 'appSecret', sealed)).toBe('secret');
    // Another column, another company, or another master key cannot open it.
    expect(() => vault.open(tenant, 'callbackToken', sealed)).toThrow();
    expect(() =>
      vault.open('22222222-2222-4222-8222-222222222222', 'appSecret', sealed),
    ).toThrow();
    expect(() =>
      new TelephonyVault(() => keyring('k2', 'b')).open(
        tenant,
        'appSecret',
        sealed,
      ),
    ).toThrow();
    expect(() =>
      new TelephonyVault(() => undefined).seal(tenant, 'appSecret', 'x'),
    ).toThrow('服务器主密钥环未配置');
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
        new Response(
          JSON.stringify({ code: 1, msg: '', data: { bind_id: 'vendor-id' } }),
        ),
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
    expect(result).toEqual({
      status: 'ACCEPTED',
      providerBindId: 'vendor-id',
      failureReason: null,
    });
    expect(capturedUrl).toBe('https://www.kuaimatongxun.com/api/call/callBind');
    expect(Object.fromEntries(new URLSearchParams(capturedBody))).toEqual({
      company_id: 'company',
      ts: '1700000000',
      sign: '196DAF7131E05360F6D6F068DD7A8244',
      api_type: 'companyapi',
      platform: 'companyapi',
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
    ).toEqual({ status: 'UNKNOWN', providerBindId: null, failureReason: null });
    // The documented shape nests bind_id under data; a top-level one is not trusted.
    expect(
      await new KuaimaProvider().dial(
        {
          companyId: 'a',
          appSecret: 'b',
          caller: '13911113002',
          callee: '13812345678',
        },
        () => Promise.resolve(new Response('{"code":1,"bind_id":"top"}')),
      ),
    ).toEqual({ status: 'UNKNOWN', providerBindId: null, failureReason: null });
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
    expect(result).toEqual({
      status: 'UNKNOWN',
      providerBindId: null,
      failureReason: null,
    });
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
      { code: 1, data: { bind_id: '  ' } },
      { code: 1, data: null },
    ]) {
      expect(
        await new KuaimaProvider().dial(input, () =>
          Promise.resolve(new Response(JSON.stringify(payload))),
        ),
      ).toEqual({
        status: 'UNKNOWN',
        providerBindId: null,
        failureReason: null,
      });
    }
    // The supplier's own short refusal is kept so the caller knows why.
    expect(
      await new KuaimaProvider().dial(input, () =>
        Promise.resolve(
          new Response(
            '{"code":0,"msg":"未获取到您的可用套餐，请联系管理员","data":null}',
          ),
        ),
      ),
    ).toEqual({
      status: 'FAILED',
      providerBindId: null,
      failureReason: '未获取到您的可用套餐，请联系管理员',
    });
    // A refusal that echoes the secret is dropped, and long text is cut.
    expect(
      await new KuaimaProvider().dial(input, () =>
        Promise.resolve(new Response('{"code":0,"msg":"bad sign for b"}')),
      ),
    ).toEqual({ status: 'FAILED', providerBindId: null, failureReason: null });
    const long = await new KuaimaProvider().dial(input, () =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 2, msg: '长'.repeat(300) })),
      ),
    );
    expect(long.failureReason).toHaveLength(120);
  });
});
