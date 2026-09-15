/**
 * §32: one predicate for "this transaction lost a write race and rolled back
 * having written nothing", shared by every caller that owns a bounded retry
 * loop (`PrismaInvitationsRepository.transaction`,
 * `WorkflowRuntimeService.execute`).
 *
 * Two shapes reach the API through `@prisma/adapter-pg`:
 *
 * - `P2034` — Prisma's own "write conflict or deadlock"; an interactive
 *   transaction that detected the conflict itself.
 * - `P2010` — "raw query failed", which is how the pg driver adapter reports a
 *   statement the server aborted. The SQLSTATE is NOT in `meta.code` in
 *   Prisma 7 (verified against a real PostgreSQL deadlock: `meta` carries only
 *   `driverAdapterError`), so both places are checked:
 *   `meta.driverAdapterError.cause.originalCode` is `40001`
 *   (serialization_failure) or `40P01` (deadlock_detected).
 *
 * A deadlock is exactly case 2: PostgreSQL aborts one of the two transactions
 * with `40P01`, the transaction rolls back cleanly, and the loser may run the
 * whole attempt again.
 */
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);

export function isWriteConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010' || !('meta' in error)) return false;
  const meta = error.meta;
  if (typeof meta !== 'object' || meta === null) return false;
  if ('code' in meta && RETRYABLE_SQLSTATES.has(meta.code as string)) {
    return true;
  }
  if (!('driverAdapterError' in meta)) return false;
  const adapterError = meta.driverAdapterError;
  if (
    typeof adapterError !== 'object' ||
    adapterError === null ||
    !('cause' in adapterError)
  ) {
    return false;
  }
  const cause = adapterError.cause;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'originalCode' in cause &&
    RETRYABLE_SQLSTATES.has(cause.originalCode as string)
  );
}
