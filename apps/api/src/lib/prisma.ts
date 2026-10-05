import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

const resets = new WeakMap<PrismaClient, Promise<void>>();

/**
 * Prisma 6 does not evict a pooled connection the server has closed (Postgres restart,
 * failover, proxy idle kill): every later query fails with P1017 until the pool is dropped.
 * Dropping it is safe — the client reconnects lazily on the next query. Debounced so a burst
 * of failing requests triggers one reset.
 */
export function resetConnectionPool(client: PrismaClient = prisma): Promise<void> {
  const pending = resets.get(client);
  if (pending) return pending;
  const reset = client
    .$disconnect()
    .catch(() => undefined)
    .finally(() => resets.delete(client));
  resets.set(client, reset);
  return reset;
}
