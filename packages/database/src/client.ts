import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

export function createDatabaseClient(connectionString: string): PrismaClient {
  if (!connectionString.trim()) {
    throw new Error("A PostgreSQL connection string is required");
  }

  // The pg driver renders timestamptz through the session time zone, but the
  // adapter then reads that wall clock as if it were UTC. Under a non-UTC
  // session every timestamp shifts by the offset: values the application
  // writes land that much earlier in storage, and values the database
  // generates (now()) come back that much later. Pinning the session to UTC
  // makes both directions round-trip exactly, which is what the API promises
  // when it returns an ISO instant ending in Z.
  const adapter = new PrismaPg({
    connectionString,
    options: "-c timezone=UTC",
  });
  return new PrismaClient({ adapter });
}
