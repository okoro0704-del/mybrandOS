import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma.js";
import { createAsset } from "../src/services/asset-service.js";
import { buildOwnerTwinContext, rejectClientTwinAssertions } from "../src/twin/owner-context.js";
import { HttpError } from "../src/lib/errors.js";

const OWNER = "TD-TWIN-OWNER";
const OTHER = "TD-TWIN-OTHER";

async function cleanup() {
  await prisma.distributionIntent.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
  await prisma.activity.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
  await prisma.asset.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: { in: [OWNER, OTHER] } } });
}

before(cleanup);
after(cleanup);

test("owner Twin context uses session Digital Life, not a client slug", async () => {
  await prisma.personalSpace.create({
    data: { ownerId: OWNER, slug: "store-owner", displayName: "Store Owner", publicEnabled: true },
  });
  await prisma.personalSpace.create({
    data: { ownerId: OTHER, slug: "other-life", displayName: "Other Life", publicEnabled: true },
  });
  await createAsset({
    ownerId: OWNER,
    title: "Owner essay",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
  });
  await createAsset({
    ownerId: OTHER,
    title: "Secret other essay",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
  });

  const context = await buildOwnerTwinContext(OWNER, "Store Owner");
  assert.equal(context.entitySlug, "store-owner");
  assert.equal(context.publications.some((row) => row.title === "Owner essay"), true);
  assert.equal(context.publications.some((row) => row.title === "Secret other essay"), false);
  assert.equal(context.publications.some((row) => /fundzman/i.test(row.title)), false);
});

test("client-selected ownership and foreign slugs are rejected", () => {
  assert.throws(
    () => rejectClientTwinAssertions({ slug: "other-life" }, "store-owner"),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  assert.throws(
    () => rejectClientTwinAssertions({ owner: true, entity: { slug: "mrfundzman" } }, "store-owner"),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
  assert.doesNotThrow(() => rejectClientTwinAssertions({ entity: { slug: "store-owner" } }, "store-owner"));
});

test("unresolved Digital Life is an honest failure", async () => {
  await assert.rejects(
    () => buildOwnerTwinContext("TD-TWIN-MISSING"),
    (err: unknown) => err instanceof HttpError && err.code === "digital_life_unresolved",
  );
});

test("Studio Twin files are not Mr Fundzman hardcoded", () => {
  const files = [
    new URL("../src/twin/owner-context.ts", import.meta.url),
    new URL("../src/twin/brief.ts", import.meta.url),
    new URL("../src/routes/twin.ts", import.meta.url),
  ];
  for (const file of files) {
    const src = readFileSync(fileURLToPath(file), "utf8");
    assert.equal(/mrfundzman/i.test(src), false, fileURLToPath(file));
  }
});
