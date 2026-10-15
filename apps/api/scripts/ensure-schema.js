import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const tables = await prisma.$queryRawUnsafe(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='PersonalSpace' LIMIT 1",
  );
  if (!Array.isArray(tables) || tables.length === 0) {
    // 10 (not 1): only a readable database without the core table may be reseeded. Node exits 1
    // on its own crashes, which must never wipe the database.
    await prisma.$disconnect();
    process.exit(10);
  }
  const cols = await prisma.$queryRawUnsafe("PRAGMA table_info(PersonalSpace)");
  const names = Array.isArray(cols)
    ? cols.map((c) => String(c && typeof c === "object" && "name" in c ? c.name : ""))
    : [];
  const draftIdem = await prisma.$queryRawUnsafe(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='DigiAiDraftIdempotency' LIMIT 1",
  );
  const publishIdem = await prisma.$queryRawUnsafe(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='DigiAiPublishIdempotency' LIMIT 1",
  );
  const sessionCols = await prisma.$queryRawUnsafe("PRAGMA table_info(Session)");
  const sessionNames = Array.isArray(sessionCols)
    ? sessionCols.map((c) => String(c && typeof c === "object" && "name" in c ? c.name : ""))
    : [];
  // Newer additive tables. A failure here can only ever mean "apply the additive schema"
  // (exit 2), never a reseed (exit 1): the table checks must not throw into the catch below.
  let missingAdditiveTables = false;
  for (const table of ["TrustAuthorization", "LikenessRequest", "CreatorAccountLink", "CreatorAccountLinkAudit", "ScheduledPublish", "MediaUploadSession"]) {
    const found = await prisma
      .$queryRawUnsafe(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='${table}' LIMIT 1`)
      .catch(() => []);
    if (!Array.isArray(found) || found.length === 0) missingAdditiveTables = true;
  }
  const importJobCols = await prisma.$queryRawUnsafe("PRAGMA table_info(ImportJob)").catch(() => []);
  await prisma.$disconnect();
  if (!names.includes("presentationConfig")) process.exit(2);
  if (!sessionNames.includes("authMethod")) process.exit(2);
  // Additive columns: a missing one means "apply the additive schema" (db push), never a reseed.
  if (!sessionNames.includes("providerToken")) process.exit(2);
  if (!names.includes("managers")) process.exit(2);
  if (Array.isArray(importJobCols) && importJobCols.length && !importJobCols.some((c) => c && c.name === "uploadSessionId")) process.exit(2);
  if (missingAdditiveTables) process.exit(2);
  if (!Array.isArray(draftIdem) || draftIdem.length === 0) process.exit(2);
  if (!Array.isArray(publishIdem) || publishIdem.length === 0) process.exit(2);
  process.exit(0);
} catch (err) {
  // A database ERROR (locked, busy, unreadable) is never evidence of a missing schema: exit 3 so the
  // entrypoint leaves prod.db untouched. Only a readable DB without PersonalSpace exits 1 (reseed).
  console.error("mybrandos: schema check failed; leaving the database untouched:", err?.message ?? err);
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  process.exit(3);
}
