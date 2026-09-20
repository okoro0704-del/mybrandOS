import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const tables = await prisma.$queryRawUnsafe(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='PersonalSpace' LIMIT 1",
  );
  if (!Array.isArray(tables) || tables.length === 0) {
    await prisma.$disconnect();
    process.exit(1);
  }
  const cols = await prisma.$queryRawUnsafe("PRAGMA table_info(PersonalSpace)");
  const names = Array.isArray(cols)
    ? cols.map((c) => String(c && typeof c === "object" && "name" in c ? c.name : ""))
    : [];
  const draftIdem = await prisma.$queryRawUnsafe(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='DigiAiDraftIdempotency' LIMIT 1",
  );
  await prisma.$disconnect();
  if (!names.includes("presentationConfig")) process.exit(2);
  if (!Array.isArray(draftIdem) || draftIdem.length === 0) process.exit(2);
  process.exit(0);
} catch {
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
}
