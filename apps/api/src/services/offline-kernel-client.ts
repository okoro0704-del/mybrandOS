/**
 * Cloud Offline Kernel client for mybrandOS Studio.
 * Device IndexedDB offlineKernel remains the local runtime — this is cloud sync only.
 */

import { stationIdForSlug } from "@mybrandos/shared";

function kernelBaseUrl(): string {
  return (process.env.OFFLINE_KERNEL_API_URL || process.env.OFFLINE_KERNEL_URL || "").replace(/\/$/, "");
}

function kernelToken(): string {
  return (
    process.env.OFFLINE_KERNEL_SERVICE_TOKEN ||
    process.env.INTERNAL_PROVISION_TOKEN ||
    process.env.WHITE_LABEL_SECRET ||
    process.env.MYBRANDOS_WHITE_LABEL_SECRET ||
    ""
  );
}

export function offlineKernelConfigured(): boolean {
  return Boolean(kernelBaseUrl());
}

async function kernelFetch(path: string, init?: RequestInit): Promise<Response | null> {
  const base = kernelBaseUrl();
  if (!base) return null;
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (!headers.has("Authorization") && kernelToken()) {
    headers.set("Authorization", `Bearer ${kernelToken()}`);
  }
  try {
    return await fetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, { ...init, headers });
  } catch {
    return null;
  }
}

export async function ensureStationForSlug(input: {
  ownerId: string;
  slug: string;
}): Promise<{ id: string; slug: string } | null> {
  const res = await kernelFetch("/v1/stations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ownerId: input.ownerId,
      slug: input.slug,
      tvEnabled: true,
      radioEnabled: true,
    }),
  });
  if (!res?.ok) return { id: stationIdForSlug(input.slug), slug: input.slug };
  return (await res.json()) as { id: string; slug: string };
}

export async function publishSurfacesToKernel(input: {
  ownerId: string;
  slug: string;
  assetId: string;
  title: string;
  surfaces: Array<"PUBLIC_APP" | "TV" | "RADIO">;
  mediaUrl?: string | null;
  coverUrl?: string | null;
  durationMs?: number | null;
}): Promise<void> {
  const channels = input.surfaces.filter((s): s is "TV" | "RADIO" => s === "TV" || s === "RADIO");
  if (!channels.length || !offlineKernelConfigured()) return;

  const station = await ensureStationForSlug({ ownerId: input.ownerId, slug: input.slug });
  if (!station) return;

  const programs = channels.map((channelType) => ({
    channelType,
    kind: "CONTENT" as const,
    title: input.title,
    assetId: input.assetId,
    mediaUrl: input.mediaUrl ?? null,
    coverUrl: input.coverUrl ?? null,
    durationMs: input.durationMs && input.durationMs > 0 ? input.durationMs : 180_000,
  }));

  await kernelFetch(`/v1/stations/${encodeURIComponent(station.id)}/programs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ programs }),
  });

  await kernelFetch(`/v1/stations/${encodeURIComponent(station.id)}/publish`, {
    method: "POST",
  });
}
