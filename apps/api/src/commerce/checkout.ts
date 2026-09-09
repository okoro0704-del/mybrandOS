import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError } from "@mybrandos/integrations";
import { normalizeOfferStatus, type CommerceCheckout, type FulfillmentType } from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { badRequest, forbidden, notFound, unavailable } from "../lib/errors.js";
import { recordActivity } from "../services/asset-service.js";
import { toOffer } from "./offers.js";

function publicCheckout(row: {
  id: string;
  offerId: string;
  state: string;
  amount: number;
  currency: string;
  failureReason: string;
  createdAt: Date;
}): CommerceCheckout {
  return {
    id: row.id,
    offerId: row.offerId,
    state: row.state as CommerceCheckout["state"],
    amount: row.amount,
    currency: row.currency,
    detail: row.failureReason || (row.state === "PAID" ? "Payment confirmed." : row.state === "PENDING" ? "Payment pending." : ""),
    createdAt: row.createdAt.toISOString(),
  };
}

async function grantPaidOrder(checkout: { id: string; offerId: string; ownerId: string; buyerId: string; amount: number; currency: string; fundzmanRef: string }) {
  const offer = await prisma.commerceItem.findUnique({ where: { id: checkout.offerId } });
  if (!offer?.assetId) throw badRequest("asset_required", "This offer has no Asset.");
  const existing = await prisma.commerceOrder.findUnique({ where: { checkoutId: checkout.id } });
  if (existing) return existing;
  const order = await prisma.commerceOrder.create({
    data: {
      checkoutId: checkout.id,
      offerId: checkout.offerId,
      ownerId: checkout.ownerId,
      buyerId: checkout.buyerId,
      paymentState: "PAID",
      fulfillmentState: "AVAILABLE",
      amount: checkout.amount,
      currency: checkout.currency,
      fundzmanRef: checkout.fundzmanRef,
    },
  });
  await prisma.commerceEntitlement.create({
    data: {
      orderId: order.id,
      offerId: checkout.offerId,
      assetId: offer.assetId,
      buyerId: checkout.buyerId,
      ownerId: checkout.ownerId,
      status: "ACTIVE",
      fulfillmentType: offer.fulfillmentType,
    },
  });
  await recordActivity({
    ownerId: checkout.ownerId,
    kind: "payment_confirmed",
    title: `Payment confirmed for ${offer.title}`,
    assetId: offer.assetId,
  });
  await recordActivity({
    ownerId: checkout.ownerId,
    kind: "entitlement_granted",
    title: `Access granted for ${offer.title}`,
    assetId: offer.assetId,
  });
  await recordActivity({
    ownerId: checkout.ownerId,
    kind: "fulfillment_completed",
    title: `Fulfillment available for ${offer.title}`,
    assetId: offer.assetId,
  });
  return order;
}

export async function startCheckout(
  buyerId: string,
  offerId: string,
  idempotencyKey: string,
  primitives: PrimitiveBindings,
) {
  const key = idempotencyKey.trim();
  if (!key) throw badRequest("idempotency_required", "Checkout requires an idempotency key.");
  const existing = await prisma.commerceCheckout.findUnique({ where: { buyerId_idempotencyKey: { buyerId, idempotencyKey: key } } });
  if (existing) return publicCheckout(existing);

  const offerRow = await prisma.commerceItem.findUnique({ where: { id: offerId } });
  if (!offerRow) throw notFound("Offer not found.");
  const offer = toOffer(offerRow);
  if (offer.status !== "ACTIVE" || !offer.assetId) throw notFound("This offer is not available.");
  if (offerRow.ownerId === buyerId) throw forbidden("Creators cannot purchase their own offer in this flow.");

  const checkout = await prisma.commerceCheckout.create({
    data: {
      offerId: offerRow.id,
      ownerId: offerRow.ownerId,
      buyerId,
      idempotencyKey: key,
      state: "CREATED",
      amount: offerRow.price,
      currency: offerRow.currency,
    },
  });
  await recordActivity({
    ownerId: offerRow.ownerId,
    kind: "checkout_started",
    title: `Checkout started for ${offerRow.title}`,
    assetId: offerRow.assetId ?? undefined,
  });

  if (!primitives.fundzMan.bound) {
    const failed = await prisma.commerceCheckout.update({
      where: { id: checkout.id },
      data: { state: "FAILED", failureReason: "payments_unavailable" },
    });
    await recordActivity({
      ownerId: offerRow.ownerId,
      kind: "payment_failed",
      title: `Payment unavailable for ${offerRow.title}`,
      assetId: offerRow.assetId ?? undefined,
    });
    void failed;
    throw unavailable("payments_unavailable", "payments_unavailable");
  }

  try {
    const payment = await primitives.fundzMan.createPayment({
      ownerId: offerRow.ownerId,
      buyerId,
      amount: offerRow.price,
      currency: offerRow.currency,
      idempotencyKey: key,
      offerId: offerRow.id,
    });
    if (payment.status === "PAID") {
      const paid = await prisma.commerceCheckout.update({
        where: { id: checkout.id },
        data: { state: "PAID", fundzmanRef: payment.reference, failureReason: "" },
      });
      await grantPaidOrder({ ...paid, fundzmanRef: payment.reference });
      return publicCheckout(paid);
    }
    if (payment.status === "FAILED") {
      const failed = await prisma.commerceCheckout.update({
        where: { id: checkout.id },
        data: { state: "FAILED", fundzmanRef: payment.reference, failureReason: payment.detail || "Payment failed." },
      });
      await recordActivity({
        ownerId: offerRow.ownerId,
        kind: "payment_failed",
        title: `Payment failed for ${offerRow.title}`,
        assetId: offerRow.assetId ?? undefined,
      });
      return publicCheckout(failed);
    }
    const pending = await prisma.commerceCheckout.update({
      where: { id: checkout.id },
      data: { state: "PENDING", fundzmanRef: payment.reference },
    });
    return publicCheckout(pending);
  } catch (err) {
    const detail = err instanceof PrimitiveError ? "payments_unavailable" : "payments_unavailable";
    await prisma.commerceCheckout.update({
      where: { id: checkout.id },
      data: { state: "FAILED", failureReason: detail },
    });
    throw unavailable("payments_unavailable", "payments_unavailable");
  }
}

export async function syncCheckout(actorId: string, checkoutId: string, primitives: PrimitiveBindings) {
  const checkout = await prisma.commerceCheckout.findUnique({ where: { id: checkoutId } });
  if (!checkout) throw notFound("Checkout not found.");
  if (checkout.buyerId !== actorId && checkout.ownerId !== actorId) throw forbidden("You cannot inspect this checkout.");
  if (checkout.state === "PAID") return publicCheckout(checkout);
  if (!primitives.fundzMan.bound || !checkout.fundzmanRef) {
    throw unavailable("payments_unavailable", "payments_unavailable");
  }
  const payment = await primitives.fundzMan.confirmPayment(checkout.fundzmanRef);
  if (payment.status === "PAID") {
    const paid = await prisma.commerceCheckout.update({
      where: { id: checkout.id },
      data: { state: "PAID", failureReason: "" },
    });
    await grantPaidOrder(paid);
    return publicCheckout(paid);
  }
  if (payment.status === "FAILED") {
    const failed = await prisma.commerceCheckout.update({
      where: { id: checkout.id },
      data: { state: "FAILED", failureReason: payment.detail || "Payment failed." },
    });
    return publicCheckout(failed);
  }
  return publicCheckout(checkout);
}

export async function cancelCheckout(buyerId: string, checkoutId: string) {
  const checkout = await prisma.commerceCheckout.findFirst({ where: { id: checkoutId, buyerId } });
  if (!checkout) throw notFound("Checkout not found.");
  if (checkout.state === "PAID") throw badRequest("already_paid", "A paid checkout cannot be cancelled.");
  const cancelled = await prisma.commerceCheckout.update({
    where: { id: checkout.id },
    data: { state: "CANCELLED", failureReason: "Cancelled by buyer." },
  });
  return publicCheckout(cancelled);
}

export async function requestRefund(ownerId: string, orderId: string, primitives: PrimitiveBindings) {
  const order = await prisma.commerceOrder.findFirst({ where: { id: orderId, ownerId } });
  if (!order) throw notFound("Order not found.");
  const result = await primitives.fundzMan.refund(order.fundzmanRef || order.id);
  return { available: result.available, detail: result.available ? result.detail : "refund_unavailable" };
}

export type FulfillmentAccess = {
  entitled: boolean;
  fulfillmentType: FulfillmentType | "";
  assetId: string;
  title: string;
  description: string;
  downloadAvailable: boolean;
  sourceHidden: true;
};

export async function getEntitlementAccess(buyerId: string, entitlementId: string): Promise<FulfillmentAccess> {
  const row = await prisma.commerceEntitlement.findFirst({ where: { id: entitlementId, buyerId } });
  if (!row || row.status !== "ACTIVE") throw forbidden("This purchase is not available.");
  const asset = await prisma.asset.findUnique({ where: { id: row.assetId } });
  const offer = await prisma.commerceItem.findUnique({ where: { id: row.offerId } });
  return {
    entitled: true,
    fulfillmentType: (row.fulfillmentType || "") as FulfillmentType | "",
    assetId: row.assetId,
    title: offer?.title || asset?.title || "Purchased work",
    description: offer?.description || asset?.description || "",
    downloadAvailable: row.fulfillmentType === "DIGITAL_DOWNLOAD" || row.fulfillmentType === "SOFTWARE_ACCESS",
    sourceHidden: true,
  };
}
