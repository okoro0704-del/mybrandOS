import { ApiError } from "./api";

export type StudioContext = { slug: string | null; publicEnabled: boolean; publicPath: string | null };
export type StudioFailure = { kind: "login" | "denied" | "tenant" | "service"; title: string; message: string };

export function studioFailure(error: unknown): StudioFailure {
  if (error instanceof ApiError) {
    if (error.status === 401) return { kind: "login", title: "Sign in to Studio", message: "Your session has expired. Sign in again." };
    if (error.status === 403) return { kind: "denied", title: "Studio access denied", message: "Your identity is not authorized to manage this brand." };
    if (error.status === 404 && error.code === "tenant_not_found") return { kind: "tenant", title: "Brand not found", message: "The requested brand could not be resolved." };
  }
  return { kind: "service", title: "Studio is temporarily unavailable", message: "The authorization service could not verify access. Please retry. If this continues, the deployment or identity service needs attention." };
}

/** A successful HTTP response alone is not an authorization contract. */
export function validateStudioContext(value: unknown, requestedSlug: string | null): StudioContext {
  const data = value as Partial<StudioContext> | null;
  if (!data || typeof data !== "object" || typeof data.publicEnabled !== "boolean"
    || !(data.slug === null || (typeof data.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)))
    || data.publicPath !== (data.slug ? `/u/${data.slug}` : null)
    || (requestedSlug !== null && data.slug !== requestedSlug)) {
    throw new Error("Invalid Studio authorization response");
  }
  return data as StudioContext;
}
