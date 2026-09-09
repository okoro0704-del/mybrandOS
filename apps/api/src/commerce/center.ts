import type { PrimitiveBindings } from "@mybrandos/integrations";
import { unboundWalletSummary } from "@mybrandos/integrations";
import type { CommerceCenterPayload, CommerceOrder } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { listOwnerOffers } from "./offers.js";

export async function buildCommerceCenter(
  ownerId: string,
  primitives: PrimitiveBindings,
): Promise<CommerceCenterPayload> {
  const [offers, orderRows, entitlementRows] = await Promise.all([
    listOwnerOffers(ownerId),
    prisma.commerceOrder.findMany({
      where: { ownerId },
      include: { offer: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    prisma.commerceEntitlement.findMany({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);

  let wallet;
  try {
    wallet = await primitives.fundzMan.summary(ownerId);
  } catch {
    wallet = unboundWalletSummary("FUNDZMAN_UNAVAILABLE");
  }
  const refunds = await primitives.fundzMan.refund("");
  const count = (kind: string) => offers.filter((item) => item.kind === kind).length;
  const orders: CommerceOrder[] = orderRows.map((row) => ({
    id: row.id,
    offerId: row.offerId,
    offerTitle: row.offer.title,
    buyerId: row.buyerId,
    paymentState: row.paymentState as CommerceOrder["paymentState"],
    fulfillmentState: row.fulfillmentState as CommerceOrder["fulfillmentState"],
    amount: row.amount,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    payments: {
      available: Boolean(wallet.bound && wallet.healthy),
      detail: wallet.bound && wallet.healthy ? "Payments use the connected money primitive." : "payments_unavailable",
    },
    refunds: { available: refunds.available, detail: refunds.available ? refunds.detail : "refund_unavailable" },
    offers,
    orders,
    entitlements: entitlementRows.map((row) => ({
      id: row.id,
      offerId: row.offerId,
      assetId: row.assetId,
      buyerId: row.buyerId,
      status: row.status as "ACTIVE" | "REVOKED" | "EXPIRED",
      fulfillmentType: row.fulfillmentType as CommerceCenterPayload["entitlements"][number]["fulfillmentType"],
      createdAt: row.createdAt.toISOString(),
    })),
    items: offers.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      status: item.status,
      assetId: item.assetId ?? undefined,
      price: item.price,
      currency: item.currency,
      fulfillmentType: item.fulfillmentType,
    })),
    metrics: {
      products: count("PRODUCT"),
      services: count("SERVICE"),
      offers: count("OFFER"),
      subscriptions: count("SUBSCRIPTION"),
      memberships: count("MEMBERSHIP"),
      periodRevenue: wallet.bound && wallet.healthy ? wallet.available : null,
      currency: wallet.currency,
      fundzmanBound: Boolean(wallet.bound && wallet.healthy),
      paidOrders: orders.filter((item) => item.paymentState === "PAID").length,
    },
  };
}
