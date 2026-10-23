import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { CreateRecordCommandInput } from './record-command';
import type { RecordsStore } from './records.repository';
import { ownershipDeadline } from './record-ownership';

/**
 * Where a record created one at a time starts on a table running the staged
 * pool. Without it such records had no stage at all: never reclaimed, absent
 * from every pool view and shown only as 旧记录.
 *
 * - An administrator who names no owner puts the record in the lead pool,
 *   where any permitted employee can claim it.
 * - An administrator who names an owner assigns it: 待联系 with the table's
 *   contact deadline, exactly as assigning from the pool does.
 * - An employee creates their own customer in 待联系, with the contact deadline.
 *
 * Tables without the staged pool keep their previous behaviour.
 */
export async function initialPoolPlacement(
  store: RecordsStore,
  context: TenantContext,
  objectCode: string,
  requestedOwner: string | null | undefined,
  now: Date,
): Promise<Partial<CreateRecordCommandInput>> {
  const pool = (await store.findPoolLifecycle?.(objectCode)) ?? null;
  if (!pool) return {};
  const at = now.toISOString();
  // Creating a record is not contact with it: an employee's own record starts
  // waiting for contact like a claimed lead, and moves on when the employee
  // confirms contact or logs an activity with a contact outcome.
  if (context.role === 'EMPLOYEE') {
    return {
      poolStage: 'PENDING_CONTACT',
      poolOrigin: 'LEAD_POOL',
      poolClaimedAt: at,
      inPublicPool: false,
      ownershipExpiresAt: ownershipDeadline(
        pool.contactTtlHours,
        now,
      )!.toISOString(),
    };
  }
  if (requestedOwner === undefined || requestedOwner === null) {
    return {
      poolStage: 'LEAD_POOL',
      poolOrigin: 'LEAD_POOL',
      inPublicPool: true,
    };
  }
  // The same check as assigning from the pool: an active member who may work
  // on this table.
  await store.lockActiveOwners(requestedOwner, objectCode);
  return {
    poolStage: 'PENDING_CONTACT',
    poolOrigin: 'LEAD_POOL',
    poolClaimedAt: at,
    inPublicPool: false,
    ownershipExpiresAt: ownershipDeadline(
      pool.contactTtlHours,
      now,
    )!.toISOString(),
  };
}
