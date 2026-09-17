import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  LocalDataZoneAdapter,
  LocalDistributionAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  LocalTrustIdAdapter,
  UnboundPlatformJobsAdapter,
} from "@mybrandos/integrations";
import { prisma } from "../src/lib/prisma.js";
import { createAsset, listPublicEligible } from "../src/services/asset-service.js";
import { executePublish } from "../src/publish/service.js";
import { getPublicBrandExperience } from "../src/services/brand-service.js";
import { getPublicAssetSocial, togglePublicAssetLove } from "../src/services/public-social.js";
import { HttpError } from "../src/lib/errors.js";

const OWNER = "TD-SOCIAL-OWNER";
const VIEWER = "TD-SOCIAL-VIEWER";
const OTHER = "TD-SOCIAL-OTHER";

function primitives() {
  return {
    trustId: new LocalTrustIdAdapter(),
    dataZone: new LocalDataZoneAdapter(),
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: new LocalFundzManAdapter(),
    distribution: new LocalDistributionAdapter(),
  };
}

async function cleanup() {
  for (const ownerId of [OWNER, VIEWER, OTHER]) {
    await prisma.distributionIntent.deleteMany({ where: { ownerId } });
    await prisma.activity.deleteMany({ where: { ownerId } });
    await prisma.personalSpace.deleteMany({ where: { ownerId } });
    await prisma.asset.deleteMany({ where: { ownerId } });
  }
}

before(cleanup);
after(cleanup);

test("Love toggles persist on Asset.analytics and reject duplicates per Trust ID", async () => {
  await prisma.personalSpace.create({
    data: {
      ownerId: OWNER,
      slug: "social-love",
      publicEnabled: true,
      displayName: "Social Love",
    },
  });
  const asset = await createAsset({
    ownerId: OWNER,
    title: "Loved Work",
    description: "A publication",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
  });
  await executePublish(
    OWNER,
    {
      assetId: asset.id,
      title: "Loved Work",
      writeup: "Body",
      visibility: "public",
      rights: { allowEmbedding: true, allowSharing: true, allowReuse: false, allowDownload: true },
      scheduleMode: "now",
      category: "content",
      contentFormat: "text",
    },
    primitives(),
  );

  const first = await togglePublicAssetLove("social-love", asset.id, VIEWER);
  assert.equal(first.lovedByMe, true);
  assert.equal(first.loves, 1);

  const again = await togglePublicAssetLove("social-love", asset.id, VIEWER);
  assert.equal(again.lovedByMe, false);
  assert.equal(again.loves, 0);

  await togglePublicAssetLove("social-love", asset.id, VIEWER);
  await togglePublicAssetLove("social-love", asset.id, OTHER);
  const guest = await togglePublicAssetLove("social-love", asset.id, "guest:abc123");
  assert.equal(guest.lovedByMe, true);
  const social = await getPublicAssetSocial("social-love", asset.id, VIEWER);
  assert.equal(social.loves, 3);
  assert.equal(social.lovedByMe, true);
  assert.equal(social.downloadAllowed, true);
  assert.equal(social.allowSharing, true);
  assert.equal(social.allowReuse, false);

  const { addPublicAssetComment } = await import("../src/services/public-social.js");
  const comment = await addPublicAssetComment(
    "social-love",
    asset.id,
    { key: "guest:abc123", displayName: "Guest ABC" },
    "Hello from a guest",
  );
  assert.equal(comment.body, "Hello from a guest");
  assert.ok(comment.createdAt);
  const after = await getPublicAssetSocial("social-love", asset.id, "guest:abc123");
  assert.equal(after.comments.length, 1);
  assert.equal(after.comments[0]?.mine, true);
  assert.equal(after.comments[0]?.createdAt, comment.createdAt);

  const exp = await getPublicBrandExperience("social-love");
  const card = exp.publishedAssets.find((a) => a.id === asset.id);
  assert.ok(card);
  assert.equal(card!.engagement.loves, 3);
  assert.equal(card!.downloadAllowed, true);
});

test("publishedAt stays stable on republish and sorts public feed chronology", async () => {
  await prisma.personalSpace.upsert({
    where: { ownerId: OWNER },
    create: {
      ownerId: OWNER,
      slug: "social-chrono",
      publicEnabled: true,
      displayName: "Chrono",
    },
    update: { slug: "social-chrono", publicEnabled: true },
  });

  const older = await createAsset({
    ownerId: OWNER,
    title: "Older",
    description: "",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
  });
  const newer = await createAsset({
    ownerId: OWNER,
    title: "Newer",
    description: "",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "DRAFT",
    visibility: "private",
  });

  await executePublish(
    OWNER,
    {
      assetId: older.id,
      title: "Older",
      writeup: "first",
      visibility: "public",
      rights: { allowEmbedding: true, allowSharing: true, allowReuse: false, allowDownload: false },
      scheduleMode: "now",
      category: "content",
      contentFormat: "text",
    },
    primitives(),
  );
  const olderRow = await prisma.asset.findUniqueOrThrow({ where: { id: older.id } });
  const olderMeta = JSON.parse(olderRow.metadata) as { publishedAt?: string };
  assert.ok(typeof olderMeta.publishedAt === "string" && olderMeta.publishedAt.length > 0);
  const stamped = olderMeta.publishedAt;

  await new Promise((r) => setTimeout(r, 20));

  await executePublish(
    OWNER,
    {
      assetId: newer.id,
      title: "Newer",
      writeup: "second",
      visibility: "public",
      rights: { allowEmbedding: true, allowSharing: true, allowReuse: false, allowDownload: false },
      scheduleMode: "now",
      category: "content",
      contentFormat: "text",
    },
    primitives(),
  );

  await executePublish(
    OWNER,
    {
      assetId: older.id,
      title: "Older republished",
      writeup: "first again",
      visibility: "public",
      rights: { allowEmbedding: true, allowSharing: true, allowReuse: false, allowDownload: false },
      scheduleMode: "now",
      category: "content",
      contentFormat: "text",
    },
    primitives(),
  );
  const olderAgain = await prisma.asset.findUniqueOrThrow({ where: { id: older.id } });
  const olderMeta2 = JSON.parse(olderAgain.metadata) as { publishedAt?: string };
  assert.equal(olderMeta2.publishedAt, stamped);

  const listed = await listPublicEligible(OWNER);
  const ids = listed.map((a) => a.id);
  assert.ok(ids.indexOf(newer.id) < ids.indexOf(older.id));
});
