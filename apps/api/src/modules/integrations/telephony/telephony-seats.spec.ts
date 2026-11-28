import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { TelephonyLine, type LineRow } from './telephony-line';
import { KuaimaProvider, KuaimaSeatError } from './telephony-provider';
import { seatUsable, seatUsername, TelephonySeats } from './telephony-seats';

const member = { id: '11111111-1111-4111-8111-111111111111', name: '孙悦' };
const username =
  'c' + createHash('sha256').update(member.id).digest('hex').slice(0, 15);

function setup() {
  const values: Record<string, string> = {
    AI_MODEL_KEYRING: JSON.stringify({
      activeKeyId: 'k',
      keys: { k: Buffer.alloc(32, 5).toString('base64') },
    }),
    TELEPHONY_LIVE_ENABLED: 'true',
  };
  const line = new TelephonyLine({
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService);
  const provider = new KuaimaProvider();
  const kuaima: LineRow = {
    mode: 'KUAIMA',
    companyId: '131',
    appSecretEncrypted: line.vault.seal('appSecret', 's'),
    callbackTokenEncrypted: line.vault.seal('callbackToken', 't'),
  };
  return {
    seats: new TelephonySeats(line, provider),
    kuaima,
    find: jest.spyOn(provider, 'findSeat').mockResolvedValue(null),
    create: jest.spyOn(provider, 'createSeat').mockResolvedValue(undefined),
    update: jest.spyOn(provider, 'updateSeat').mockResolvedValue(undefined),
  };
}

describe('automatic seats', () => {
  it('names a member seat account the same way every time', () => {
    expect(seatUsername(member.id)).toBe(username);
    expect(username).toHaveLength(16);
    expect(seatUsable(`MOCK-${username}`, 'MOCK')).toBe(true);
    expect(seatUsable(`MOCK-${username}`, 'KUAIMA')).toBe(false);
    expect(seatUsable('', 'MOCK')).toBe(false);
    expect(seatUsable('135', 'KUAIMA')).toBe(true);
  });
  it('gives a simulated seat on the simulated line without calling the supplier', async () => {
    const { seats, kuaima, find, create, update } = setup();
    expect(
      await seats.ensure(
        { ...kuaima, mode: 'MOCK' },
        null,
        member,
        '13900000000',
      ),
    ).toEqual({ seatId: `MOCK-${username}`, username });
    for (const spy of [find, create, update])
      expect(spy).not.toHaveBeenCalled();
  });
  it('creates a seat with a random password and reads its ID back', async () => {
    const { seats, kuaima, find, create } = setup();
    find
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: '135', username, mobile: '13900000000' });
    expect(await seats.ensure(kuaima, null, member, '13900000000')).toEqual({
      seatId: '135',
      username,
    });
    const [account, seat] = create.mock.calls[0];
    expect(account).toEqual({
      companyId: '131',
      appSecret: 's',
      origin: 'https://www.kuaimatongxun.com',
    });
    expect(seat).toMatchObject({
      username,
      nickname: '孙悦',
      mobile: '13900000000',
    });
    expect(seat.password).toMatch(/^[\w-]{16}$/);
  });
  it('adopts a seat that was created but never saved, fixing its mobile', async () => {
    const { seats, kuaima, find, create, update } = setup();
    find.mockResolvedValueOnce({ id: '140', username, mobile: '13800000000' });
    expect(
      await seats.ensure(
        kuaima,
        { seatId: `MOCK-${username}`, username, phone: '13900000000' },
        member,
        '13900000000',
      ),
    ).toEqual({ seatId: '140', username });
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.anything(), '140', {
      mobile: '13900000000',
      nickname: '孙悦',
    });
  });
  it('only updates the mobile of a seat it already has', async () => {
    const { seats, kuaima, find, update } = setup();
    const current = { seatId: '140', username, phone: '13800000000' };
    await seats.ensure(kuaima, current, member, '13900000000');
    await seats.ensure(
      kuaima,
      { ...current, phone: '13900000000' },
      member,
      '13900000000',
    );
    expect(find).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.anything(), '140', {
      mobile: '13900000000',
      nickname: '孙悦',
    });
  });
  it('reports a seat the supplier accepted but cannot find', async () => {
    const { seats, kuaima } = setup();
    await expect(
      seats.ensure(kuaima, null, member, '13900000000'),
    ).rejects.toBeInstanceOf(KuaimaSeatError);
  });
});
