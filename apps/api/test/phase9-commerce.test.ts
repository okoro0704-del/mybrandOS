import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  LocalDataZoneAdapter,
  LocalDistributionAdapter,
  LocalElfComAdapter,
  LocalFundzManAdapter,
  LocalMasterDistributorAdapter,
  LocalTrustIdAdapter,
  TestAiProvider,
  TestFundzManAdapter,
  UnboundPlatformJobsAdapter,
} from "@mybrandos/integrations";
import { LIFEOS_PRIMITIVE_IDS, publicAssetKeys, type TrustIdIdentity } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { createAsset } from "../src/services/asset-service.js";
import { HttpError } from "../src/lib/errors.js";
import { createOffer, transitionOffer, updateOffer } from "../src/commerce/offers.js";
import { cancelCheckout, getEntitlementAccess, startCheckout } from "../src/commerce/checkout.js";
import { listBuyerEntitlements, revokeEntitlement } from "../src/commerce/entitlements.js";
import { buildCommerceCenter } from "../src/commerce/center.js";
import { getPublicAsset, getPublicBrandExperience, updateBrandConfig } from "../src/services/brand-service.js";
import { buildCommandCenter } from "../src/services/gateway-service.js";

const OWNER = "TD-P9-OWNER";
const BUYER = "TD-P9-BUYER";
const OTHER = "TD-P9-OTHER";

function identity(): TrustIdIdentity {
  return {
    trustId: OWNER,
    status: "local",
    displayName: "Ada Commerce",
    identityStatus: "local",
    verificationLevel: "none",
    isVerifiedIdentity: false,
    trustTier: 1,
    trustStars: 1,
    bound: false,
  };
}

function primitives(fundz = new LocalFundzManAdapter() as LocalFundzManAdapter | TestFundzManAdapter) {
  return {
    trustId: new LocalTrustIdAdapter(),
    dataZone: new LocalDataZoneAdapter(),
    elfCom: new LocalElfComAdapter(),
    platformJobs: new UnboundPlatformJobsAdapter(),
    masterDistributor: new LocalMasterDistributorAdapter(),
    fundzMan: fundz,
    distribution: new LocalDistributionAdapter(),
    ai: new TestAiProvider(),
  };
}

async function cleanup() {
  const offers = await prisma.commerceItem.findMany({ where: { ownerId: { in: [OWNER, BUYER, OTHER] } }, select: { id: true } });
  const offerIds = offers.map((row) => row.id);
  if (offerIds.length) {
    await prisma.commerceEntitlement.deleteMany({ where: { offerId: { in: offerIds } } });
    await prisma.commerceOrder.deleteMany({ where: { offerId: { in: offerIds } } });
    await prisma.commerceCheckout.deleteMany({ where: { offerId: { in: offerIds } } });
    await prisma.commerceItem.deleteMany({ where: { id: { in: offerIds } } });
  }
  await prisma.activity.deleteMany({ where: { ownerId: { in: [OWNER, BUYER, OTHER] } } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: { in: [OWNER, BUYER, OTHER] } } });
  await prisma.asset.deleteMany({ where: { ownerId: { in: [OWNER, BUYER, OTHER] } } });
}

before(cleanup);
after(cleanup);

async function publishedBook() {
  return createAsset({
    ownerId: OWNER,
    title: "P9 Harbor Book",
    description: "A published book for commerce.",
    assetType: "BOOK",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
  });
}

test("offers can be created updated activated paused and archived", async () => {
  const asset = await publishedBook();
  const offer = await createOffer(OWNER, { assetId: asset.id, price: 25, fulfillmentType: "DIGITAL_ACCESS" });
  assert.equal(offer.status, "DRAFT");
  assert.equal(offer.assetId, asset.id);
  const updated = await updateOffer(OWNER, offer.id, { price: 40, title: "Harbor Book Offer" });
  assert.equal(updated.price, 40);
  const active = await transitionOffer(OWNER, offer.id, "ACTIVE");
  assert.equal(active.status, "ACTIVE");
  const paused = await transitionOffer(OWNER, offer.id, "PAUSED");
  assert.equal(paused.status, "PAUSED");
  await transitionOffer(OWNER, offer.id, "ACTIVE");
  const archived = await transitionOffer(OWNER, offer.id, "ARCHIVED");
  assert.equal(archived.status, "ARCHIVED");
  await assert.rejects(() => updateOffer(BUYER, offer.id, { price: 1 }), (err: unknown) => err instanceof HttpError && err.statusCode === 404);
});

test("unbound FundzMan checkout stays payments_unavailable and grants nothing", async () => {
  const asset = await createAsset({
    ownerId: OWNER,
    title: "P9 Unbound Book",
    description: "Unbound checkout.",
    assetType: "BOOK",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
  });
  const offer = await createOffer(OWNER, { assetId: asset.id, price: 12, fulfillmentType: "DIGITAL_ACCESS" });
  await transitionOffer(OWNER, offer.id, "ACTIVE");
  await assert.rejects(
    () => startCheckout(BUYER, offer.id, "idem-unbound", primitives()),
    (err: unknown) => err instanceof HttpError && err.code === "payments_unavailable",
  );
  const entitlements = await listBuyerEntitlements(BUYER);
  assert.equal(entitlements.some((item) => item.offerId === offer.id), false);
  const center = await buildCommerceCenter(OWNER, primitives());
  assert.equal(center.payments.available, false);
  assert.equal(center.payments.detail, "payments_unavailable");
  assert.equal(center.metrics.periodRevenue, null);
});

test("successful FundzMan confirmation creates order and entitlement", async () => {
  const asset = await createAsset({
    ownerId: OWNER,
    title: "P9 Paid Course",
    description: "Paid course access.",
    assetType: "COURSE",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
  });
  const offer = await createOffer(OWNER, { assetId: asset.id, price: 80, fulfillmentType: "COURSE_ACCESS" });
  await transitionOffer(OWNER, offer.id, "ACTIVE");
  const checkout = await startCheckout(BUYER, offer.id, "idem-paid", primitives(new TestFundzManAdapter("success")));
  assert.equal(checkout.state, "PAID");
  const again = await startCheckout(BUYER, offer.id, "idem-paid", primitives(new TestFundzManAdapter("success")));
  assert.equal(again.id, checkout.id);
  const entitlements = await listBuyerEntitlements(BUYER);
  const mine = entitlements.find((item) => item.offerId === offer.id);
  assert.ok(mine);
  const access = await getEntitlementAccess(BUYER, mine!.id);
  assert.equal(access.entitled, true);
  assert.equal(access.sourceHidden, true);
  assert.equal(access.fulfillmentType, "COURSE_ACCESS");
  await assert.rejects(() => getEntitlementAccess(OTHER, mine!.id), (err: unknown) => err instanceof HttpError && err.statusCode === 403);
});

test("failed and invalid FundzMan responses do not grant access", async () => {
  const asset = await createAsset({
    ownerId: OWNER,
    title: "P9 Fail Music",
    description: "Failed payment.",
    assetType: "MUSIC",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
  });
  const offer = await createOffer(OWNER, { assetId: asset.id, price: 15, fulfillmentType: "DIGITAL_ACCESS" });
  await transitionOffer(OWNER, offer.id, "ACTIVE");
  const failed = await startCheckout(BUYER, offer.id, "idem-fail", primitives(new TestFundzManAdapter("fail")));
  assert.equal(failed.state, "FAILED");
  const invalid = await startCheckout(BUYER, offer.id, "idem-invalid", primitives(new TestFundzManAdapter("invalid")));
  assert.equal(invalid.state, "FAILED");
  assert.equal((await listBuyerEntitlements(BUYER)).some((item) => item.offerId === offer.id), false);
});

test("buyer can cancel a pending checkout and revoked entitlement denies access", async () => {
  const asset = await createAsset({
    ownerId: OWNER,
    title: "P9 Cancel Writing",
    description: "Cancel checkout.",
    assetType: "WRITING",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
  });
  const offer = await createOffer(OWNER, { assetId: asset.id, price: 9, fulfillmentType: "DIGITAL_ACCESS" });
  await transitionOffer(OWNER, offer.id, "ACTIVE");
  const pending = await startCheckout(BUYER, offer.id, "idem-pending", primitives(new TestFundzManAdapter("pending")));
  assert.equal(pending.state, "PENDING");
  const cancelled = await cancelCheckout(BUYER, pending.id);
  assert.equal(cancelled.state, "CANCELLED");
  const paid = await startCheckout(BUYER, offer.id, "idem-revoke", primitives(new TestFundzManAdapter("success")));
  assert.equal(paid.state, "PAID");
  const entitlement = (await listBuyerEntitlements(BUYER)).find((item) => item.offerId === offer.id);
  assert.ok(entitlement);
  await revokeEntitlement(OWNER, entitlement!.id);
  await assert.rejects(() => getEntitlementAccess(BUYER, entitlement!.id), (err: unknown) => err instanceof HttpError && err.statusCode === 403);
});

test("public experience shows active offers only and hides internals", async () => {
  await updateBrandConfig(identity(), { slug: "p9-commerce-life", publicEnabled: true, displayName: "Ada Commerce" });
  const asset = await createAsset({
    ownerId: OWNER,
    title: "P9 Public Software",
    description: "Public software offer.",
    assetType: "SOFTWARE",
    origin: "CREATED_INTERNAL",
    status: "PUBLISHED",
    visibility: "public",
    metadata: { software: { hasPublicPackage: true, version: "1.0.0" } },
  });
  const draft = await createOffer(OWNER, { assetId: asset.id, title: "Draft software offer", price: 50, fulfillmentType: "SOFTWARE_ACCESS" });
  const active = await createOffer(OWNER, { assetId: asset.id, title: "Active software offer", price: 50, fulfillmentType: "SOFTWARE_ACCESS" });
  await transitionOffer(OWNER, active.id, "ACTIVE");
  const experience = await getPublicBrandExperience("p9-commerce-life", primitives());
  assert.equal((experience.offers ?? []).some((item) => item.id === active.id), true);
  assert.equal((experience.offers ?? []).some((item) => item.id === draft.id), false);
  assert.equal((experience.offers ?? [])[0]?.checkoutAvailable, false);
  assert.equal((experience.offers ?? [])[0]?.checkoutDetail, "payments_unavailable");
  const card = experience.publishedAssets.find((item) => item.id === asset.id);
  assert.ok(card);
  assert.deepEqual(Object.keys(card!).sort(), [...publicAssetKeys()].sort());
  const blob = JSON.stringify(experience);
  assert.equal(blob.includes("dz_"), false);
  assert.equal(blob.includes("fundzman"), false);
  assert.equal(blob.includes("ownerId"), false);
  const detail = await getPublicAsset("p9-commerce-life", asset.id);
  assert.equal(detail.offer?.id, active.id);
  const command = await buildCommandCenter(OWNER, primitives());
  assert.ok(command.health?.attention.some((item) => item.detail.includes("payments_unavailable") || item.title.includes("Payment")));
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
});
