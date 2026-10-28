import { Prisma } from '@crm/database';
import type { RecordOwnerFilter } from './record-read-scope';

export function recordOwnerSql(
  filter: RecordOwnerFilter | null | undefined,
  column: Prisma.Sql = Prisma.sql`owner_member_id`,
): Prisma.Sql {
  if (filter === undefined) return Prisma.sql`TRUE`;
  if (filter === null) return Prisma.sql`${column} IS NULL`;
  if (typeof filter === 'string')
    return Prisma.sql`${column} = ${filter}::uuid`;
  if (filter.in.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${column} IN (${Prisma.join(filter.in.map((id) => Prisma.sql`${id}::uuid`))})`;
}
