import { isWriteConflict } from './write-conflict';

/**
 * §32: the predicate every bounded retry loop rests on.
 *
 * The `P2010` shapes below are not invented — they were captured from the real
 * client (`@prisma/adapter-pg` 7.9.1 against PostgreSQL) by making two
 * transactions lock two rows in opposite orders. A deadlock arrives as
 * `meta.driverAdapterError.cause.originalCode === '40P01'` with NO `meta.code`,
 * which is why the predicate reads the driver's cause and not only `meta.code`.
 */
function p2010(meta: Record<string, unknown>): unknown {
  return { code: 'P2010', meta };
}

describe('isWriteConflict', () => {
  it('accepts the P2034 Prisma raises for a detected write conflict', () => {
    expect(isWriteConflict({ code: 'P2034' })).toBe(true);
  });

  it('accepts the serialization failure a driver reports as 40001', () => {
    expect(isWriteConflict(p2010({ code: '40001' }))).toBe(true);
    expect(
      isWriteConflict(
        p2010({
          driverAdapterError: { cause: { originalCode: '40001' } },
        }),
      ),
    ).toBe(true);
  });

  it('accepts the deadlock a driver reports as 40P01', () => {
    expect(isWriteConflict(p2010({ code: '40P01' }))).toBe(true);
    // The exact shape a real lock-order deadlock produced.
    expect(
      isWriteConflict(
        p2010({
          driverAdapterError: {
            name: 'DriverAdapterError',
            cause: {
              originalCode: '40P01',
              originalMessage: 'deadlock detected',
              kind: 'postgres',
            },
          },
        }),
      ),
    ).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isWriteConflict(p2010({ code: '42501' }))).toBe(false);
    expect(
      isWriteConflict(
        p2010({
          driverAdapterError: { cause: { originalCode: '23505' } },
        }),
      ),
    ).toBe(false);
    expect(isWriteConflict({ code: 'P2002' })).toBe(false);
    expect(isWriteConflict({ code: 'P2010' })).toBe(false);
    expect(isWriteConflict(new Error('boom'))).toBe(false);
    expect(isWriteConflict(null)).toBe(false);
    expect(isWriteConflict(undefined)).toBe(false);
  });
});
