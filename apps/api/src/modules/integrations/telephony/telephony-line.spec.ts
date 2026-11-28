import type { ConfigService } from '@nestjs/config';
import { TelephonyLine, type LineRow } from './telephony-line';

const keyring = (byte: number) =>
  JSON.stringify({
    activeKeyId: 'k',
    keys: { k: Buffer.alloc(32, byte).toString('base64') },
  });
function lineWith(env: Record<string, string>) {
  const values: Record<string, string> = {
    AI_MODEL_KEYRING: keyring(3),
    ...env,
  };
  return new TelephonyLine({
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService);
}
const empty: LineRow = {
  mode: 'KUAIMA',
  companyId: '',
  appSecretEncrypted: null,
  callbackTokenEncrypted: null,
};

describe('platform telephony line', () => {
  it('lists every missing piece of the supplier line', () => {
    expect(lineWith({}).problems(empty)).toEqual([
      '企业 ID 未填写',
      '企业密钥未填写',
      '回调地址未生成',
      '服务器未开启真实外呼（TELEPHONY_LIVE_ENABLED）',
    ]);
  });
  it('is ready once account, callback and server switch are in place', () => {
    const line = lineWith({ TELEPHONY_LIVE_ENABLED: 'true' });
    const row: LineRow = {
      mode: 'KUAIMA',
      companyId: '131',
      appSecretEncrypted: line.vault.seal('appSecret', 's'),
      callbackTokenEncrypted: line.vault.seal('callbackToken', 't'),
    };
    expect(line.problems(row)).toEqual([]);
    expect(line.account(row)).toEqual({
      companyId: '131',
      appSecret: 's',
      origin: 'https://www.kuaimatongxun.com',
    });
    expect(
      lineWith({
        TELEPHONY_LIVE_ENABLED: 'true',
        AI_MODEL_KEYRING: keyring(9),
      }).problems(row),
    ).toEqual(['密钥无法解开，请重新填写企业密钥并重新生成回调地址']);
  });
  it('allows the simulated line outside production only', () => {
    const mock: LineRow = { ...empty, mode: 'MOCK' };
    expect(lineWith({}).problems(mock)).toEqual([]);
    expect(lineWith({ NODE_ENV: 'production' }).problems(mock)).toEqual([
      '正式环境不能用模拟线路',
    ]);
  });
  it('uses a loopback supplier stand-in only outside production', () => {
    const local = 'http://127.0.0.1:3199';
    expect(lineWith({ TELEPHONY_KUAIMA_ORIGIN: local }).kuaimaOrigin()).toBe(
      local,
    );
    expect(
      lineWith({
        TELEPHONY_KUAIMA_ORIGIN: 'http://evil.example',
      }).kuaimaOrigin(),
    ).toBe('https://www.kuaimatongxun.com');
    expect(
      lineWith({
        NODE_ENV: 'production',
        TELEPHONY_KUAIMA_ORIGIN: local,
      }).kuaimaOrigin(),
    ).toBe('https://www.kuaimatongxun.com');
    expect(
      lineWith({ API_ORIGIN: 'https://api.example.com/' }).callbackEndpoint(),
    ).toBe('https://api.example.com/api/v1/telephony/hooks');
  });
});
