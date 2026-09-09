export const OFFER_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const FULFILLMENT_TYPES = [
  "DIGITAL_DOWNLOAD",
  "DIGITAL_ACCESS",
  "COURSE_ACCESS",
  "SOFTWARE_ACCESS",
  "EVENT_ACCESS",
  "CONTENT_ACCESS",
] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

export const CHECKOUT_STATES = ["CREATED", "PENDING", "PAID", "FAILED", "CANCELLED", "EXPIRED"] as const;
export type CheckoutState = (typeof CHECKOUT_STATES)[number];

export const ORDER_PAYMENT_STATES = ["PENDING", "PAID", "FAILED", "CANCELLED"] as const;
export type OrderPaymentState = (typeof ORDER_PAYMENT_STATES)[number];

export const FULFILLMENT_STATES = ["PENDING", "AVAILABLE", "DELIVERED", "FAILED"] as const;
export type FulfillmentState = (typeof FULFILLMENT_STATES)[number];

export const ENTITLEMENT_STATUSES = ["ACTIVE", "REVOKED", "EXPIRED"] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export interface CommerceOffer {
  id: string;
  assetId: string | null;
  title: string;
  description: string;
  kind: "PRODUCT" | "SERVICE" | "OFFER" | "SUBSCRIPTION" | "MEMBERSHIP";
  status: OfferStatus;
  price: number;
  currency: string;
  fulfillmentType: FulfillmentType | "";
  availability: "AVAILABLE" | "UNAVAILABLE";
  createdAt: string;
  updatedAt: string;
}

export interface PublicOfferCard {
  id: string;
  assetId: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  fulfillmentType: FulfillmentType | "";
  checkoutAvailable: boolean;
  checkoutDetail: string;
}

export interface CommerceCheckout {
  id: string;
  offerId: string;
  state: CheckoutState;
  amount: number;
  currency: string;
  detail: string;
  createdAt: string;
}

export interface CommerceOrder {
  id: string;
  offerId: string;
  offerTitle: string;
  buyerId: string;
  paymentState: OrderPaymentState;
  fulfillmentState: FulfillmentState;
  amount: number;
  currency: string;
  createdAt: string;
}

export interface CommerceEntitlement {
  id: string;
  offerId: string;
  assetId: string;
  status: EntitlementStatus;
  fulfillmentType: FulfillmentType | "";
  createdAt: string;
}

export interface CommerceCenterPayload {
  payments: { available: boolean; detail: string };
  refunds: { available: boolean; detail: string };
  offers: CommerceOffer[];
  orders: CommerceOrder[];
  entitlements: Array<CommerceEntitlement & { buyerId: string }>;
  items: Array<{
    id: string;
    kind: CommerceOffer["kind"];
    title: string;
    status: string;
    assetId?: string;
    price?: number;
    currency?: string;
    fulfillmentType?: string;
  }>;
  metrics: {
    products: number;
    services: number;
    offers: number;
    subscriptions: number;
    memberships: number;
    periodRevenue: number | null;
    currency: string;
    fundzmanBound: boolean;
    paidOrders: number;
  };
}

export function normalizeOfferStatus(raw: string): OfferStatus {
  const value = raw.trim().toUpperCase();
  if (value === "LIVE") return "ACTIVE";
  if ((OFFER_STATUSES as readonly string[]).includes(value)) return value as OfferStatus;
  return "DRAFT";
}

export function defaultFulfillmentType(assetType: string): FulfillmentType {
  if (assetType === "COURSE") return "COURSE_ACCESS";
  if (assetType === "SOFTWARE") return "SOFTWARE_ACCESS";
  if (assetType === "MUSIC" || assetType === "BOOK" || assetType === "WRITING") return "DIGITAL_ACCESS";
  if (assetType === "VIDEO") return "CONTENT_ACCESS";
  return "DIGITAL_DOWNLOAD";
}
