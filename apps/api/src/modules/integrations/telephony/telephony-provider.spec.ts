import { createHash } from 'node:crypto';
import {
  normalizePhone,
  KuaimaProvider,
  KuaimaSeatError,
  safeRecordingUrl,
  signature,
  TelephonyVault,
} from './telephony-provider';

const keyring = (id: string, byte: string) =>
  JSON.stringify({
    activeKeyId: id,
    keys: { [id]: Buffer.alloc(32, byte).toString('base64') },
  });

describe('telephony provider boundary', () => {
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
  it('seals platform secrets with the keyring, bound to the secret kind', () => {
    const vault = new TelephonyVault(() => keyring('k1', 'a'));
    const sealed = vault.seal('appSecret', 'secret');
    expect(sealed).not.toContain('secret');
    expect(vault.seal('appSecret', 'secret')).not.toBe(sealed);
    expect(vault.open('appSecret', sealed)).toBe('secret');
    // Another column or another master key cannot open it.
    expect(() => vault.open('callbackToken', sealed)).toThrow();
    expect(() =>
      new TelephonyVault(() => keyring('k2', 'b')).open('appSecret', sealed),
    ).toThrow();
    expect(() =>
      new TelephonyVault(() => undefined).seal('appSecret', 'x'),
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

describe('kuaima seats', () => {
  const account = {
    companyId: '131',
    appSecret: 'app-secret',
    origin: 'https://kuaima.example',
  };
  const seat = {
    username: 'cabc',
    nickname: '孙悦',
    mobile: '13900000000',
    password: 'pw-123456',
  };
  const provider = new KuaimaProvider();
  const reply = (payload: unknown, status = 200) =>
    jest.fn(() =>
      Promise.resolve(new Response(JSON.stringify(payload), { status })),
    );
  const sent = (transport: jest.Mock, call = 0) => {
    const [url, init] = transport.mock.calls[call] as unknown as [
      string,
      RequestInit,
    ];
    return { url, form: Object.fromEntries(init.body as URLSearchParams) };
  };

  it('signs enterprise requests the way the supplier documents', async () => {
    expect(signature('123', 'abc123def456', 1678901234)).toBe(
      createHash('md5')
        .update('123abc123def4561678901234')
        .digest('hex')
        .toUpperCase(),
    );
    const transport = reply({ code: 1, msg: 'success', data: { list: [] } });
    await provider.findSeat(account, 'cabc', transport, 1678901234);
    expect(sent(transport)).toEqual({
      url: 'https://kuaima.example/api/company/getSeatsList',
      form: {
        company_id: '131',
        ts: '1678901234',
        sign: signature('131', 'app-secret', 1678901234),
        page: '1',
        limit: '10',
        username: 'cabc',
      },
    });
  });

  it('finds only the exact seat account and reads its numeric ID', async () => {
    const transport = reply({
      code: 1,
      data: {
        list: [
          { id: 140, username: 'cabc1', mobile: '13800000001' },
          { id: 135, username: 'cabc', mobile: '13800000002' },
        ],
      },
    });
    expect(await provider.findSeat(account, 'cabc', transport)).toEqual({
      id: '135',
      username: 'cabc',
      mobile: '13800000002',
    });
    expect(
      await provider.findSeat(account, 'none', reply({ code: 1, data: {} })),
    ).toBeNull();
  });

  it('creates a seat as a one-item JSON list and never echoes its password', async () => {
    const transport = reply({ code: 1, msg: '添加成功', data: null });
    await provider.createSeat(account, seat, transport);
    const { url, form } = sent(transport);
    expect(url).toBe('https://kuaima.example/api/company/createSeats');
    expect(JSON.parse(form.seats)).toEqual([seat]);
    await expect(
      provider.createSeat(
        account,
        seat,
        reply({ code: 0, msg: '手机号已存在' }),
      ),
    ).rejects.toMatchObject({ reason: '手机号已存在' });
    await expect(
      provider.createSeat(
        account,
        seat,
        reply({ code: 0, msg: '密码 pw-123456 不合规' }),
      ),
    ).rejects.toMatchObject({ reason: '快马拒绝了请求' });
  });

  it('updates a seat mobile by seat ID', async () => {
    const transport = reply({ code: 1, msg: '更新成功！', data: null });
    await provider.updateSeat(
      account,
      '135',
      { mobile: '13900000001', nickname: '孙悦' },
      transport,
    );
    expect(sent(transport).url).toBe(
      'https://kuaima.example/api/company/updateSeats',
    );
    expect(sent(transport).form).toMatchObject({
      seats_id: '135',
      mobile: '13900000001',
      nickname: '孙悦',
    });
  });

  it('turns an unreachable or broken supplier into a readable seat error', async () => {
    const down = jest.fn(() => Promise.reject(new Error('ECONNRESET')));
    await expect(provider.findSeat(account, 'cabc', down)).rejects.toEqual(
      expect.any(KuaimaSeatError),
    );
    await expect(
      provider.findSeat(account, 'cabc', down),
    ).rejects.toMatchObject({ reason: '快马接口无响应，请稍后重试' });
    await expect(
      provider.findSeat(account, 'cabc', reply({}, 502)),
    ).rejects.toMatchObject({ reason: '快马接口返回 HTTP 502' });
    await expect(
      provider.findSeat(
        account,
        'cabc',
        reply({ code: 0, msg: 'app-secret 错误' }),
      ),
    ).rejects.toMatchObject({ reason: '快马拒绝了请求' });
  });
});
