import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TelephonyLine, type LineMode, type LineRow } from './telephony-line';
import { KuaimaProvider, KuaimaSeatError } from './telephony-provider';

/** A member's supplier account: fixed, so a retry finds a half-saved seat. */
export function seatUsername(memberId: string) {
  return 'c' + createHash('sha256').update(memberId).digest('hex').slice(0, 15);
}
/** A simulated seat does not exist at the supplier. */
export function seatUsable(seatId: string, mode: LineMode) {
  return Boolean(seatId) && (mode === 'MOCK' || !seatId.startsWith('MOCK-'));
}
export type Seat = { seatId: string; username: string };

@Injectable()
export class TelephonySeats {
  constructor(
    private readonly line: TelephonyLine,
    private readonly provider: KuaimaProvider,
  ) {}

  /**
   * Makes sure the member has a seat that answers on `phone`. Calls the
   * supplier only; the caller saves the result. Throws KuaimaSeatError.
   */
  async ensure(
    line: LineRow,
    current: { seatId: string; username: string; phone: string } | null,
    member: { id: string; name: string },
    phone: string,
  ): Promise<Seat> {
    const username = seatUsername(member.id);
    if (line.mode === 'MOCK') return { seatId: `MOCK-${username}`, username };
    const account = this.line.account(line);
    const changes = { mobile: phone, nickname: member.name };
    if (current && seatUsable(current.seatId, 'KUAIMA')) {
      if (current.phone !== phone)
        await this.provider.updateSeat(account, current.seatId, changes);
      return { seatId: current.seatId, username: current.username || username };
    }
    let seat = await this.provider.findSeat(account, username);
    if (seat) {
      if (seat.mobile !== phone)
        await this.provider.updateSeat(account, seat.id, changes);
    } else {
      await this.provider.createSeat(account, {
        username,
        ...changes,
        password: randomBytes(12).toString('base64url'),
      });
      seat = await this.provider.findSeat(account, username);
      if (!seat)
        throw new KuaimaSeatError(
          '快马已受理建坐席，但查不到这个坐席，请稍后重试',
        );
    }
    return { seatId: seat.id, username };
  }
}
