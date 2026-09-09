import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError } from "@mybrandos/integrations";
import type { TrustIdIdentity } from "@mybrandos/shared";
import {
  DEFAULT_BRAND_THEME,
  DEFAULT_PUBLIC_NAV,
  emptyPublicPresentation,
  normalizeSlug,
  normalizeTheme,
  publicExperiencePath,
  sortNav,
  isReservedSlug,
  parsePresentationTypes,
  liveNowFromSession,
  type BrandConfigPayload,
  type BrandCta,
  type BrandMedia,
  type BrandMediaSlot,
  type BrandTheme,
  type PublicAssetCard,
  type PublicAssetDetail,
  type PublicBrandExperience,
  type PublicLink,
  type PublicLiveNow,
  type PublicNavItem,
  type PublicNavItemConfig,
} from "@mybrandos/shared";
import { prisma } from "../lib/prisma.js";
import { readJson, writeJson } from "../lib/json.js";
import { badRequest, conflict, notFound, unavailable } from "../lib/errors.js";
import { listPublicEligible, listPublished } from "./asset-service.js";
import { isDistributedLiveToLifeOs } from "../live/distributions.js";
import type { Asset } from "@mybrandos/shared";

const MEDIA_SLOTS: BrandMediaSlot[] = ["logo", "avatar", "cover"];

function emptyMessaging() {
  return { available: false, detail: "Messaging is currently unavailable." };
}

async function messagingFor(ownerId: string, primitives?: PrimitiveBindings) {
  if (!primitives) return emptyMessaging();
  const inbox = await primitives.elfCom.inbox(ownerId);
  return {
    available: inbox.bound && !inbox.unavailable,
    detail:
      inbox.unavailable || !inbox.bound
        ? "Messaging is currently unavailable."
        : "Messaging is available.",
  };
}

export function toPublicAssetCard(asset: Asset): PublicAssetCard {
  const presentationTypes =
    asset.assetType === "VIDEO"
      ? parsePresentationTypes(asset.metadata?.presentationTypes).length
        ? parsePresentationTypes(asset.metadata.presentationTypes)
        : parsePresentationTypes(asset.metadata?.presentationType).length
          ? parsePresentationTypes(asset.metadata.presentationType)
          : (["WATCH"] as const)
      : parsePresentationTypes(asset.metadata?.presentationTypes);
  const music = (asset.metadata?.music ?? {}) as Record<string, unknown>;
  const writing = (asset.metadata?.writing ?? {}) as Record<string, unknown>;
  const software = (asset.metadata?.software ?? {}) as Record<string, unknown>;
  const presentation = emptyPublicPresentation();
  if (asset.assetType === "MUSIC") {
    presentation.artist = typeof music.artistName === "string" ? music.artistName : "";
    presentation.playAvailable = Boolean(music.hasAudio ?? asset.dataZoneId);
  }
  if (asset.assetType === "WRITING") {
    presentation.author = typeof writing.authorName === "string" ? writing.authorName : "";
    presentation.body = typeof writing.body === "string" ? writing.body : "";
  }
  if (asset.assetType === "SOFTWARE") {
    presentation.version = typeof software.version === "string" ? software.version : "";
    presentation.developer = typeof software.developer === "string" ? software.developer : "";
    presentation.license = typeof software.license === "string" ? software.license : "";
    presentation.documentationUrl = typeof software.documentationUrl === "string" ? software.documentationUrl : "";
    presentation.repositoryUrl = typeof software.repositoryUrl === "string" ? software.repositoryUrl : "";
    presentation.websiteUrl = typeof software.websiteUrl === "string" ? software.websiteUrl : "";
    presentation.downloadAvailable = Boolean(software.hasPublicPackage);
    presentation.storeAvailable = false;
  }
  return {
    id: asset.id,
    title: asset.title,
    description: asset.description,
    assetType: asset.assetType,
    publishedAt: asset.updatedAt,
    coverAvailable:
      asset.assetType === "MUSIC"
        ? Boolean(music.hasCover)
        : asset.assetType === "SOFTWARE"
          ? false
          : Boolean(asset.dataZoneId),
    presentationTypes: [...presentationTypes],
    isLiveReplay: asset.origin === "LIVE_REPLAY" || Boolean(asset.metadata?.liveReplay),
    presentation,
  };
}

export function publicSafeKeys(value: object): string[] {
  return Object.keys(value);
}

function orderByIds<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const map = new Map(items.map((item) => [item.id, item]));
  return ids.map((id) => map.get(id)).filter((item): item is T => Boolean(item));
}

export async function resolveFeaturedAssetIds(ownerId: string, ids: string[]): Promise<string[]> {
  const ordered = ids.filter((id, index) => id && ids.indexOf(id) === index);
  if (!ordered.length) return [];
  const rows = await prisma.asset.findMany({
    where: { ownerId, id: { in: ordered }, status: "PUBLISHED", visibility: "public" },
    select: { id: true },
  });
  const allowed = new Set(rows.map((row) => row.id));
  const invalid = ordered.filter((id) => !allowed.has(id));
  if (invalid.length) {
    throw badRequest("invalid_featured_assets", "Featured items must be published public Assets you own.");
  }
  return ordered;
}

function parseNav(raw: string | null | undefined): PublicNavItemConfig[] {
  const stored = readJson<PublicNavItemConfig[]>(raw, []);
  if (!stored.length) return DEFAULT_PUBLIC_NAV.map((item, index) => ({ ...item, order: index }));
  return sortNav(
    stored.map((item, index) => ({
      id: String(item.id || `nav-${index}`),
      kind: item.kind ?? "work",
      label: String(item.label || item.id || "Section"),
      enabled: Boolean(item.enabled),
      order: typeof item.order === "number" ? item.order : index,
      assetTypes: item.assetTypes,
      presentationTypes: item.presentationTypes,
      alwaysShow: item.alwaysShow,
    })),
  ).map((item, index) => ({ ...item, order: index }));
}

function parseCta(raw: string | null | undefined): BrandCta | null {
  const value = readJson<BrandCta | Record<string, unknown>>(raw, {});
  if (!value || typeof value !== "object") return null;
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const href = typeof value.href === "string" ? value.href.trim() : "";
  if (!label || !href) return null;
  return { label, href };
}

function parseMedia(raw: string | null | undefined): BrandMedia {
  const stored = readJson<BrandMedia>(raw, {});
  const media: BrandMedia = {};
  for (const slot of MEDIA_SLOTS) {
    const ref = stored[slot];
    if (ref?.dataZoneId) {
      media[slot] = {
        dataZoneId: ref.dataZoneId,
        filename: ref.filename || slot,
        mimeType: ref.mimeType || "application/octet-stream",
      };
    }
  }
  return media;
}

function navHref(slug: string | null, item: PublicNavItemConfig): string {
  const base = slug ? publicExperiencePath(slug) : "/brand/preview";
  if (item.kind === "home") return base;
  return `${base}/${item.id}`;
}

function projectNavigation(
  items: PublicNavItemConfig[],
  published: PublicAssetCard[],
  slug: string | null,
): PublicNavItem[] {
  return sortNav(items)
    .filter((item) => item.enabled)
    .map((item) => {
      const matching =
        item.kind === "collection" && item.presentationTypes?.length
          ? published.filter((asset) => asset.presentationTypes.some((type) => item.presentationTypes!.includes(type)))
          : item.kind === "collection" && item.assetTypes?.length
            ? published.filter((asset) => item.assetTypes!.includes(asset.assetType))
            : published;
      const available =
        item.alwaysShow ||
        item.kind === "home" ||
        item.kind === "about" ||
        item.kind === "contact" ||
        matching.length > 0;
      return {
        ...item,
        href: navHref(slug, item),
        available,
      };
    })
    .filter((item) => item.available || item.alwaysShow);
}

async function spaceRow(ownerId: string) {
  return prisma.personalSpace.findUnique({ where: { ownerId } });
}

export async function getBrandConfig(
  identity: TrustIdIdentity,
  primitives?: PrimitiveBindings,
): Promise<BrandConfigPayload> {
  const ownerId = identity.trustId;
  const [space, published, eligible] = await Promise.all([
    spaceRow(ownerId),
    listPublished(ownerId),
    listPublicEligible(ownerId),
  ]);
  const featuredAssetIds = space ? readJson<string[]>(space.featuredAssetIds, []) : [];
  const eligibleCards = eligible.map(toPublicAssetCard);
  const featuredAssets = orderByIds(eligibleCards, featuredAssetIds);
  const nav = parseNav(space?.publicNav);
  const media = parseMedia(space?.brandMedia);
  const slug = space?.slug ?? null;

  return {
    configured: Boolean(space),
    publicEnabled: Boolean(space?.publicEnabled && slug),
    slug,
    publicPath: slug ? publicExperiencePath(slug) : null,
    identity: {
      displayName: space?.displayName || identity.displayName,
      tagline: space?.headline || "",
      bio: space?.bio || "",
    },
    media,
    theme: normalizeTheme(readJson<Partial<BrandTheme>>(space?.theme, {})),
    navigation: nav,
    cta: parseCta(space?.cta),
    links: space ? readJson<PublicLink[]>(space.links, []) : [],
    featuredAssetIds,
    featuredAssets,
    publishedAssets: eligibleCards,
    messaging: await messagingFor(ownerId, primitives),
    liveNow: await publicLiveNowForOwner(ownerId, space?.displayName || identity.displayName),
  };
}

export async function updateBrandConfig(
  identity: TrustIdIdentity,
  patch: {
    displayName?: string;
    tagline?: string;
    bio?: string;
    slug?: string | null;
    publicEnabled?: boolean;
    theme?: Partial<BrandTheme>;
    navigation?: PublicNavItemConfig[];
    cta?: BrandCta | null;
    links?: PublicLink[];
    featuredAssetIds?: string[];
  },
  primitives?: PrimitiveBindings,
): Promise<BrandConfigPayload> {
  const ownerId = identity.trustId;
  const existing = await spaceRow(ownerId);

  let slug = existing?.slug ?? null;
  if (patch.slug !== undefined) {
    const normalized = patch.slug ? normalizeSlug(patch.slug) : "";
    if (patch.slug && (!normalized || normalized.length < 3)) {
      throw badRequest("invalid_slug", "Choose a public address with at least 3 letters or numbers.");
    }
    if (normalized && isReservedSlug(normalized)) {
      throw badRequest("reserved_slug", "That public address is reserved.");
    }
    if (normalized) {
      const clash = await prisma.personalSpace.findFirst({
        where: { slug: normalized, NOT: { ownerId } },
      });
      if (clash) throw conflict("slug_taken", "That public address is already in use.");
      slug = normalized;
    } else {
      slug = null;
    }
  }

  const featuredAssetIds =
    patch.featuredAssetIds !== undefined
      ? await resolveFeaturedAssetIds(ownerId, patch.featuredAssetIds)
      : undefined;

  const navigation =
    patch.navigation !== undefined
      ? sortNav(patch.navigation).map((item, order) => ({ ...item, order }))
      : undefined;

  const publicEnabled =
    patch.publicEnabled !== undefined ? Boolean(patch.publicEnabled) : existing?.publicEnabled ?? false;
  if (publicEnabled && !slug) {
    throw badRequest("slug_required", "Choose a public address before making the branded experience available.");
  }

  const theme = patch.theme ? normalizeTheme({ ...DEFAULT_BRAND_THEME, ...patch.theme }) : undefined;
  const cta =
    patch.cta === undefined
      ? undefined
      : patch.cta && patch.cta.label.trim() && patch.cta.href.trim()
        ? { label: patch.cta.label.trim(), href: patch.cta.href.trim() }
        : {};

  await prisma.personalSpace.upsert({
    where: { ownerId },
    create: {
      ownerId,
      displayName: patch.displayName ?? identity.displayName,
      headline: patch.tagline ?? "",
      bio: patch.bio ?? "",
      slug,
      publicEnabled,
      theme: writeJson(theme ?? DEFAULT_BRAND_THEME),
      publicNav: writeJson(navigation ?? DEFAULT_PUBLIC_NAV),
      cta: writeJson(cta ?? {}),
      links: writeJson(patch.links ?? []),
      featuredAssetIds: writeJson(featuredAssetIds ?? []),
    },
    update: {
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.tagline !== undefined ? { headline: patch.tagline } : {}),
      ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
      ...(patch.slug !== undefined ? { slug } : {}),
      ...(patch.publicEnabled !== undefined ? { publicEnabled } : {}),
      ...(theme ? { theme: writeJson(theme) } : {}),
      ...(navigation !== undefined ? { publicNav: writeJson(navigation) } : {}),
      ...(cta !== undefined ? { cta: writeJson(cta) } : {}),
      ...(patch.links ? { links: writeJson(patch.links) } : {}),
      ...(featuredAssetIds !== undefined ? { featuredAssetIds: writeJson(featuredAssetIds) } : {}),
    },
  });

  return getBrandConfig(identity, primitives);
}

export async function storeBrandMedia(
  identity: TrustIdIdentity,
  slot: BrandMediaSlot,
  file: { filename: string; mimeType: string; bytes: Buffer },
  primitives: PrimitiveBindings,
) {
  if (!MEDIA_SLOTS.includes(slot)) {
    throw badRequest("invalid_media_slot", "Use logo, avatar, or cover.");
  }
  if (!file.mimeType.startsWith("image/")) {
    throw badRequest("invalid_media_type", "Brand media must be an image stored in file storage.");
  }
  let stored;
  try {
    stored = await primitives.dataZone.storeBytes({
      filename: file.filename,
      mimeType: file.mimeType,
      bytes: file.bytes,
    });
  } catch (err) {
    if (err instanceof PrimitiveError) throw unavailable(err.code, err.message);
    throw unavailable("DATAZONE_UNAVAILABLE", "File storage is currently unavailable. The image was not saved.");
  }
  if (!stored.dataZoneId) {
    throw unavailable("DATAZONE_UNAVAILABLE", "File storage is currently unavailable. The image was not saved.");
  }

  const existing = await spaceRow(identity.trustId);
  const media = parseMedia(existing?.brandMedia);
  media[slot] = {
    dataZoneId: stored.dataZoneId,
    filename: stored.filename || file.filename,
    mimeType: stored.mimeType || file.mimeType,
  };

  await prisma.personalSpace.upsert({
    where: { ownerId: identity.trustId },
    create: {
      ownerId: identity.trustId,
      displayName: identity.displayName,
      brandMedia: writeJson(media),
      theme: writeJson(DEFAULT_BRAND_THEME),
      publicNav: writeJson(DEFAULT_PUBLIC_NAV),
    },
    update: { brandMedia: writeJson(media) },
  });

  return getBrandConfig(identity, primitives);
}

async function loadBrandMediaBytes(
  media: BrandMedia,
  slot: BrandMediaSlot,
  primitives: PrimitiveBindings,
) {
  const ref = media[slot];
  if (!ref) throw notFound("That brand image is not available.");
  let stored;
  try {
    stored = await primitives.dataZone.getBytes(ref.dataZoneId);
  } catch (err) {
    if (err instanceof PrimitiveError) throw unavailable(err.code, err.message);
    throw unavailable("DATAZONE_UNAVAILABLE", "File storage is currently unavailable.");
  }
  if (!stored) throw notFound("That brand image is not available.");
  return {
    bytes: stored.bytes,
    mimeType: stored.mimeType || ref.mimeType,
    filename: stored.filename || ref.filename,
  };
}

export async function getOwnerBrandMedia(
  identity: TrustIdIdentity,
  slot: BrandMediaSlot,
  primitives: PrimitiveBindings,
) {
  const space = await spaceRow(identity.trustId);
  return loadBrandMediaBytes(parseMedia(space?.brandMedia), slot, primitives);
}

export async function getOwnerAssetCover(
  identity: TrustIdIdentity,
  assetId: string,
  primitives: PrimitiveBindings,
) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId: identity.trustId, status: "PUBLISHED" },
  });
  if (!asset?.dataZoneId) throw notFound("No public cover is available for this Asset.");
  return readAssetCover(asset.dataZoneId, primitives);
}

async function readAssetCover(dataZoneId: string, primitives: PrimitiveBindings) {
  let stored;
  try {
    stored = await primitives.dataZone.getBytes(dataZoneId);
  } catch (err) {
    if (err instanceof PrimitiveError) throw unavailable(err.code, err.message);
    throw unavailable("DATAZONE_UNAVAILABLE", "File storage is currently unavailable.");
  }
  if (!stored) throw notFound("No public cover is available for this Asset.");
  return {
    bytes: stored.bytes,
    mimeType: stored.mimeType || "application/octet-stream",
    filename: stored.filename || "cover",
  };
}

async function experienceFrom(
  space: NonNullable<Awaited<ReturnType<typeof spaceRow>>>,
  eligible: Asset[],
  messaging: PublicBrandExperience["messaging"],
  displayNameFallback: string,
  liveNow: PublicLiveNow | null = null,
  primitives?: PrimitiveBindings,
): Promise<PublicBrandExperience> {
  const slug = space.slug ?? "";
  const featuredIds = readJson<string[]>(space.featuredAssetIds, []);
  const publishedAssets = eligible.map(toPublicAssetCard);
  const featuredAssets = orderByIds(publishedAssets, featuredIds);
  const nav = parseNav(space.publicNav);
  const media = parseMedia(space.brandMedia);

  return {
    slug,
    publicEnabled: Boolean(space.publicEnabled && slug),
    configured: true,
    identity: {
      displayName: space.displayName || displayNameFallback,
      tagline: space.headline || "",
      bio: space.bio || "",
      hasLogo: Boolean(media.logo),
      hasAvatar: Boolean(media.avatar),
      hasCover: Boolean(media.cover),
    },
    theme: normalizeTheme(readJson<Partial<BrandTheme>>(space.theme, {})),
    cta: parseCta(space.cta),
    navigation: projectNavigation(nav, publishedAssets, slug || null),
    featuredAssets,
    publishedAssets,
    publicLinks: readJson<PublicLink[]>(space.links, []),
    messaging,
    liveNow,
    offers: await (await import("../commerce/offers.js")).listPublicOffers(
      space.ownerId,
      eligible.map((asset) => asset.id),
      Boolean(primitives?.fundzMan.bound),
    ),
  };
}

async function publicLiveNowForOwner(ownerId: string, creatorName: string): Promise<PublicLiveNow | null> {
  const row = await prisma.liveSession.findFirst({
    where: { ownerId, status: "LIVE", visibility: "public" },
    orderBy: { startedAt: "desc" },
  });
  if (!row?.startedAt) return null;
  if (!(await isDistributedLiveToLifeOs(row.id))) return null;
  return liveNowFromSession(
    {
      id: row.id,
      title: row.title,
      status: "LIVE",
      visibility: "public",
      startedAt: row.startedAt.toISOString(),
    },
    creatorName,
  );
}

export async function buildBrandPreview(
  identity: TrustIdIdentity,
  primitives?: PrimitiveBindings,
): Promise<PublicBrandExperience> {
  const space = await spaceRow(identity.trustId);
  const eligible = await listPublicEligible(identity.trustId);
  const messaging = await messagingFor(identity.trustId, primitives);
  if (!space) {
    return {
      slug: "",
      publicEnabled: false,
      configured: false,
      identity: {
        displayName: identity.displayName,
        tagline: "",
        bio: "",
        hasLogo: false,
        hasAvatar: false,
        hasCover: false,
      },
      theme: DEFAULT_BRAND_THEME,
      cta: null,
      navigation: projectNavigation(DEFAULT_PUBLIC_NAV, [], null),
      featuredAssets: [],
      publishedAssets: [],
      publicLinks: [],
      messaging,
      liveNow: null,
      offers: [],
    };
  }
  const liveNow = await publicLiveNowForOwner(identity.trustId, space.displayName || identity.displayName);
  return experienceFrom(space, eligible, messaging, identity.displayName, liveNow, primitives);
}

export async function getPublicBrandExperience(
  slug: string,
  primitives?: PrimitiveBindings,
): Promise<PublicBrandExperience> {
  const normalized = normalizeSlug(slug);
  if (!normalized) throw notFound("This branded experience is not available.");
  const space = await prisma.personalSpace.findUnique({ where: { slug: normalized } });
  if (!space || !space.publicEnabled) {
    throw notFound("This branded experience is not available.");
  }
  const eligible = await listPublicEligible(space.ownerId);
  const messaging = await messagingFor(space.ownerId, primitives);
  const liveNow = await publicLiveNowForOwner(space.ownerId, space.displayName || "Creator");
  return experienceFrom(space, eligible, messaging, space.displayName || "Creator", liveNow, primitives);
}

export async function getPublicLive(slug: string): Promise<{ liveNow: PublicLiveNow | null }> {
  const experience = await getPublicBrandExperience(slug);
  return { liveNow: experience.liveNow };
}

export async function getPublicAssets(slug: string) {
  const experience = await getPublicBrandExperience(slug);
  return { assets: experience.publishedAssets };
}

export async function getPublicAsset(slug: string, assetId: string): Promise<PublicAssetDetail> {
  const experience = await getPublicBrandExperience(slug);
  const card = experience.publishedAssets.find((asset) => asset.id === assetId);
  if (!card) throw notFound("This work is not available.");
  return {
    ...card,
    brandName: experience.identity.displayName,
    cta: experience.cta,
    offer: (experience.offers ?? []).find((item) => item.assetId === assetId) ?? null,
  };
}

export async function getPublicBrandMedia(
  slug: string,
  slot: BrandMediaSlot,
  primitives: PrimitiveBindings,
) {
  const normalized = normalizeSlug(slug);
  const space = await prisma.personalSpace.findUnique({ where: { slug: normalized } });
  if (!space || !space.publicEnabled) throw notFound("This branded experience is not available.");
  return loadBrandMediaBytes(parseMedia(space.brandMedia), slot, primitives);
}

export async function getPublicAssetCover(slug: string, assetId: string, primitives: PrimitiveBindings) {
  const detail = await getPublicAsset(slug, assetId);
  if (!detail.coverAvailable) throw notFound("No public cover is available for this Asset.");
  const space = await prisma.personalSpace.findUnique({ where: { slug: normalizeSlug(slug) } });
  if (!space || !space.publicEnabled) throw notFound("This branded experience is not available.");
  const asset = await prisma.asset.findFirst({
    where: {
      id: assetId,
      ownerId: space.ownerId,
      status: "PUBLISHED",
      visibility: "public",
    },
    select: { dataZoneId: true, assetType: true, sourceProjectId: true },
  });
  if (asset?.assetType === "MUSIC" && asset.sourceProjectId) {
    const meta = await prisma.musicMetadata.findUnique({ where: { projectId: asset.sourceProjectId } });
    if (meta?.coverFileId) {
      const cover = await prisma.projectFile.findFirst({
        where: { id: meta.coverFileId, projectId: asset.sourceProjectId },
      });
      if (cover) return readAssetCover(cover.dataZoneId, primitives);
    }
  }
  if (!asset?.dataZoneId) throw notFound("No public cover is available for this Asset.");
  return readAssetCover(asset.dataZoneId, primitives);
}

export async function getPublicAssetMedia(slug: string, assetId: string, primitives: PrimitiveBindings) {
  await getPublicAsset(slug, assetId);
  const space = await prisma.personalSpace.findUnique({ where: { slug: normalizeSlug(slug) } });
  if (!space || !space.publicEnabled) throw notFound("This work is not available.");
  const asset = await prisma.asset.findFirst({
    where: {
      id: assetId,
      ownerId: space.ownerId,
      status: "PUBLISHED",
      visibility: "public",
      assetType: { in: ["VIDEO", "MUSIC", "SOFTWARE"] },
    },
    select: { dataZoneId: true, assetType: true, metadata: true },
  });
  if (asset?.assetType === "SOFTWARE") {
    const meta = readJson<Record<string, unknown>>(asset.metadata, {});
    const software = (meta.software ?? {}) as Record<string, unknown>;
    if (!software.hasPublicPackage || !asset.dataZoneId) throw notFound("This work is not available.");
  }
  if (!asset?.dataZoneId) throw notFound("This work is not available.");
  return readAssetCover(asset.dataZoneId, primitives);
}

export function assertPublicProjection(experience: PublicBrandExperience) {
  const leaked = JSON.stringify(experience);
  return {
    hasOwnerId: leaked.includes('"ownerId"'),
    hasJobId: /jobId/i.test(leaked),
    hasDataZoneId: leaked.includes("dataZoneId"),
    hasPrimitive: /trust-id|platform-jobs|sovereign-drive|fundzman|elfcom/i.test(leaked),
  };
}
