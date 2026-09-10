import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='PersonalSpace' LIMIT 1",
  );
  await prisma.$disconnect();
  process.exit(Array.isArray(rows) && rows.length > 0 ? 0 : 1);
} catch {
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
}
