/**
 * Creator Space — one public environment with collapsible destinations.
 * Side slots swap with the active destination. Space is a separate overlay.
 */

export const HOME_DESTINATIONS = ["APP", "BRAND", "DIGIPEDIA", "NEWS", "RADIO", "TV", "SPACE"] as const;
export type HomeDestination = (typeof HOME_DESTINATIONS)[number];

/** Surfaces that can occupy the viewport, including Space. */
export const CREATOR_SPACE_SURFACES = HOME_DESTINATIONS;
export type CreatorSpaceSurface = HomeDestination;

export const SWAP_DESTINATIONS = ["APP", "BRAND", "DIGIPEDIA", "NEWS", "RADIO", "TV"] as const;
export type SwapDestination = (typeof SWAP_DESTINATIONS)[number];

export const HOME_SLOT_IDS = ["UL", "ML", "LL", "UR", "MR", "LR"] as const;
export type HomeSlotId = (typeof HOME_SLOT_IDS)[number];

export const HOME_SLOT_OCCUPANTS = ["APP", "BRAND", "DIGIPEDIA", "NEWS", "RADIO", "TV", "INTERACTIONS"] as const;
export type HomeSlotOccupant = (typeof HOME_SLOT_OCCUPANTS)[number];

export const HOME_SLOT_PAIRS = [
  { band: "upper", left: "UL", right: "UR" },
  { band: "middle", left: "ML", right: "MR" },
  { band: "lower", left: "LL", right: "LR" },
] as const;

export type HomeSlotBand = (typeof HOME_SLOT_PAIRS)[number]["band"];

/** Interactions stays in the upper-right slot and never becomes a destination. */
export const INTERACTIONS_SLOT: HomeSlotId = "UR";

export const INITIAL_HOME_SLOTS: Record<HomeSlotId, HomeSlotOccupant> = {
  UL: "BRAND",
  ML: "DIGIPEDIA",
  LL: "RADIO",
  UR: "INTERACTIONS",
  MR: "NEWS",
  LR: "TV",
};

export const CREATOR_SPACE_RUNTIMES = ["ACTIVE", "WARM", "SUSPENDED"] as const;
export type CreatorSpaceRuntime = (typeof CREATOR_SPACE_RUNTIMES)[number];

export const SPACE_EDGES = ["left", "right", "center"] as const;
export type SpaceEdge = (typeof SPACE_EDGES)[number];

/** Radio does not keep playing under another surface unless this is flipped later. */
export const RADIO_BACKGROUND_ENABLED = false;

export const LEFT_EDGE_SURFACES: CreatorSpaceSurface[] = ["SPACE", "NEWS", "DIGIPEDIA"];
export const RIGHT_EDGE_SURFACES: CreatorSpaceSurface[] = ["TV", "RADIO"];

export type HomeNavSnapshot = {
  active: HomeDestination;
  slots: Record<HomeSlotId, HomeSlotOccupant>;
  returnFromSpace: SwapDestination | null;
  interactionsOpen: boolean;
  interactionsView: "overview" | "comments";
};

export function isHomeDestination(value: string | null | undefined): value is HomeDestination {
  return HOME_DESTINATIONS.includes(value as HomeDestination);
}

export function isSwapDestination(value: string | null | undefined): value is SwapDestination {
  return SWAP_DESTINATIONS.includes(value as SwapDestination);
}

export function isHomeSlotOccupant(value: string | null | undefined): value is HomeSlotOccupant {
  return HOME_SLOT_OCCUPANTS.includes(value as HomeSlotOccupant);
}

export function isCreatorSpaceSurface(value: string | null | undefined): value is CreatorSpaceSurface {
  if (value === "DIGINEWS") return true;
  return isHomeDestination(value);
}

export function normalizeHomeDestination(value: string | null | undefined, fallback: HomeDestination = "APP"): HomeDestination {
  if (value === "DIGINEWS") return "NEWS";
  return isHomeDestination(value) ? value : fallback;
}

export function cloneHomeSlots(slots: Record<HomeSlotId, HomeSlotOccupant> = INITIAL_HOME_SLOTS): Record<HomeSlotId, HomeSlotOccupant> {
  return { ...slots };
}

export function initialHomeNav(active: HomeDestination = "APP"): HomeNavSnapshot {
  const dest = active === "SPACE" ? "APP" : active;
  const slots = cloneHomeSlots();
  if (dest !== "APP" && isSwapDestination(dest)) {
    const slot = HOME_SLOT_IDS.find((id) => slots[id] === dest);
    if (slot) slots[slot] = "APP";
  }
  return {
    active: dest,
    slots,
    returnFromSpace: null,
    interactionsOpen: false,
    interactionsView: "overview",
  };
}

export function homeNavInvariants(snapshot: HomeNavSnapshot): string[] {
  const errors: string[] = [];
  if (snapshot.slots[INTERACTIONS_SLOT] !== "INTERACTIONS") errors.push("interactions-unpinned");
  const occupants = HOME_SLOT_IDS.map((id) => snapshot.slots[id]);
  if (occupants.filter((item) => item === "INTERACTIONS").length !== 1) errors.push("interactions-count");
  if (occupants.includes(snapshot.active === "SPACE" ? snapshot.returnFromSpace || "APP" : snapshot.active)) {
    errors.push("active-duplicated-in-slots");
  }
  const pool = occupants.filter((item) => item !== "INTERACTIONS");
  const visibleActive: SwapDestination =
    snapshot.active === "SPACE" ? snapshot.returnFromSpace || "APP" : isSwapDestination(snapshot.active) ? snapshot.active : "APP";
  const dests = [...pool, visibleActive];
  if (new Set(dests).size !== SWAP_DESTINATIONS.length) errors.push("lost-or-duplicated-destination");
  for (const dest of SWAP_DESTINATIONS) {
    if (!dests.includes(dest)) errors.push(`missing:${dest}`);
  }
  return errors;
}

export function swapHomeSlot(
  snapshot: HomeNavSnapshot,
  slot: HomeSlotId,
): HomeNavSnapshot | null {
  if (slot === INTERACTIONS_SLOT || snapshot.slots[slot] === "INTERACTIONS") return null;
  const current = snapshot.active === "SPACE" ? snapshot.returnFromSpace || "APP" : snapshot.active;
  if (!isSwapDestination(current)) return null;
  const occupant = snapshot.slots[slot];
  if (!isSwapDestination(occupant) || occupant === current) return null;
  const slots = cloneHomeSlots(snapshot.slots);
  slots[slot] = current;
  return {
    ...snapshot,
    active: occupant,
    slots,
    returnFromSpace: null,
    interactionsOpen: false,
    interactionsView: "overview",
  };
}

export function openHomeSpace(snapshot: HomeNavSnapshot): HomeNavSnapshot {
  if (snapshot.active === "SPACE") return snapshot;
  const current = isSwapDestination(snapshot.active) ? snapshot.active : "APP";
  return {
    ...snapshot,
    active: "SPACE",
    slots: cloneHomeSlots(snapshot.slots),
    returnFromSpace: current,
    interactionsOpen: false,
    interactionsView: "overview",
  };
}

export function closeHomeSpace(snapshot: HomeNavSnapshot): HomeNavSnapshot {
  if (snapshot.active !== "SPACE") return snapshot;
  return {
    ...snapshot,
    active: snapshot.returnFromSpace || "APP",
    slots: cloneHomeSlots(snapshot.slots),
    returnFromSpace: null,
  };
}

export function openHomeInteractions(snapshot: HomeNavSnapshot): HomeNavSnapshot {
  return { ...snapshot, interactionsOpen: true, interactionsView: "overview" };
}

export function closeHomeInteractions(snapshot: HomeNavSnapshot): HomeNavSnapshot {
  return { ...snapshot, interactionsOpen: false, interactionsView: "overview" };
}

export function openHomeComments(snapshot: HomeNavSnapshot): HomeNavSnapshot {
  return { ...snapshot, interactionsOpen: true, interactionsView: "comments" };
}

export function homeNavEquals(a: HomeNavSnapshot, b: HomeNavSnapshot): boolean {
  return (
    a.active === b.active &&
    a.returnFromSpace === b.returnFromSpace &&
    a.interactionsOpen === b.interactionsOpen &&
    a.interactionsView === b.interactionsView &&
    HOME_SLOT_IDS.every((id) => a.slots[id] === b.slots[id])
  );
}

export function spaceEdgeFor(surface: CreatorSpaceSurface): SpaceEdge {
  if (LEFT_EDGE_SURFACES.includes(surface)) return "left";
  if (RIGHT_EDGE_SURFACES.includes(surface)) return "right";
  return "center";
}

export function spaceSurfaceLifecycle(
  active: CreatorSpaceSurface,
  candidate: CreatorSpaceSurface,
  previous: CreatorSpaceSurface | null,
): CreatorSpaceRuntime {
  if (candidate === active) return "ACTIVE";
  if (previous && candidate === previous) return "WARM";
  if (active === "SPACE" && previous && candidate === previous) return "WARM";
  return "SUSPENDED";
}

export function stationModeFromSurface(surface: CreatorSpaceSurface): "APP" | "TV" | "RADIO" {
  if (surface === "TV") return "TV";
  if (surface === "RADIO") return "RADIO";
  return "APP";
}

export function surfaceProducesMedia(surface: CreatorSpaceSurface): boolean {
  return surface === "APP" || surface === "TV" || surface === "RADIO";
}

export function radioShouldPlay(surface: CreatorSpaceSurface): boolean {
  if (surface === "RADIO") return true;
  return RADIO_BACKGROUND_ENABLED && surface !== "TV";
}

export type CreatorSpaceRef = {
  slug: string;
  displayName: string;
};

export function slugFromPublicHref(href: string): string | null {
  try {
    const url = new URL(href, "https://getlifeos.app");
    const hostSlug = url.hostname.replace(/\.getlifeos\.app$/i, "");
    if (hostSlug && hostSlug !== url.hostname && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(hostSlug)) return hostSlug;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "u" && parts[1] && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[1])) return parts[1];
    return null;
  } catch {
    return null;
  }
}

export function mergeCreatorSpaces(current: CreatorSpaceRef, recents: CreatorSpaceRef[], linked: CreatorSpaceRef[]): CreatorSpaceRef[] {
  const out: CreatorSpaceRef[] = [];
  const seen = new Set<string>();
  for (const row of [current, ...recents, ...linked]) {
    const slug = row.slug.trim().toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, displayName: row.displayName || slug });
  }
  return out.slice(0, 12);
}

export function homeOccupantLabel(occupant: HomeSlotOccupant, brandName = "Brand"): string {
  if (occupant === "APP") return "App";
  if (occupant === "BRAND") return brandName || "Brand";
  if (occupant === "DIGIPEDIA") return "Digipedia";
  if (occupant === "NEWS") return "News";
  if (occupant === "RADIO") return "Radio";
  if (occupant === "TV") return "TV";
  return "Interactions";
}

/** Full-screen media/knowledge/station surfaces. Interactions and Space are overlays. */
export const CREATOR_MEDIA_SURFACES = ["APP", "DIGIPEDIA", "NEWS", "RADIO", "TV"] as const;
export type CreatorMediaSurface = (typeof CREATOR_MEDIA_SURFACES)[number];

export const EDGE_LAUNCHER_SIDES = ["left", "right", "space"] as const;
export type EdgeLauncherSide = (typeof EDGE_LAUNCHER_SIDES)[number];

export const LEFT_LAUNCH_ITEMS = ["SPACE", "NEWS", "DIGIPEDIA"] as const;
export const RIGHT_LAUNCH_ITEMS = ["TV", "RADIO"] as const;

export type LaunchTarget = (typeof LEFT_LAUNCH_ITEMS)[number] | (typeof RIGHT_LAUNCH_ITEMS)[number] | "INTERACTIONS";

export const LAUNCHER_IDLE_MS = 4000;
export const LAUNCHER_REVEAL_MS = 240;

export function firstTouchReveals(open: EdgeLauncherSide | null, side: EdgeLauncherSide): boolean {
  return open !== side;
}

export const CREATOR_SPACE_UI_STATES = ["HOME", "SUMMONED", "INTERACTION", "SURFACE"] as const;
export type CreatorSpaceUiState = (typeof CREATOR_SPACE_UI_STATES)[number];

export type CreatorSpaceModel = {
  ui: CreatorSpaceUiState;
  surface: CreatorSpaceSurface;
  summonedSide: EdgeLauncherSide | null;
  interactionsView: "overview" | "comments";
};

export type CreatorSpaceUiAction =
  | { type: "REVEAL"; side: EdgeLauncherSide }
  | { type: "COLLAPSE" }
  | { type: "LAUNCH"; target: LaunchTarget }
  | { type: "DISMISS_INTERACTION" }
  | { type: "OPEN_COMMENTS" }
  | { type: "CLOSE_COMMENTS" }
  | { type: "SET_SURFACE"; surface: CreatorSpaceSurface };

export function initialCreatorSpaceModel(surface: CreatorSpaceSurface = "APP"): CreatorSpaceModel {
  const dest = normalizeHomeDestination(surface);
  if (dest === "APP") {
    return { ui: "HOME", surface: "APP", summonedSide: null, interactionsView: "overview" };
  }
  return { ui: "SURFACE", surface: dest, summonedSide: null, interactionsView: "overview" };
}

export function creatorSpaceUiState(model: Pick<CreatorSpaceModel, "surface" | "summonedSide" | "ui"> & { interactionsOpen?: boolean }): CreatorSpaceUiState {
  if (model.ui === "INTERACTION" || model.interactionsOpen) return "INTERACTION";
  if (model.summonedSide) return "SUMMONED";
  if (model.surface === "APP") return "HOME";
  return "SURFACE";
}

function restUi(surface: CreatorSpaceSurface): CreatorSpaceUiState {
  return surface === "APP" ? "HOME" : "SURFACE";
}

export function reduceCreatorSpace(model: CreatorSpaceModel, action: CreatorSpaceUiAction): CreatorSpaceModel {
  switch (action.type) {
    case "REVEAL": {
      const open = firstTouchReveals(model.ui === "SUMMONED" ? model.summonedSide : null, action.side);
      if (!open) {
        return { ...model, ui: restUi(model.surface), summonedSide: null, interactionsView: "overview" };
      }
      return {
        ...model,
        ui: "SUMMONED",
        summonedSide: action.side,
        interactionsView: "overview",
      };
    }
    case "COLLAPSE":
      return { ...model, ui: restUi(model.surface), summonedSide: null };
    case "LAUNCH": {
      if (action.target === "INTERACTIONS") {
        return {
          ui: "INTERACTION",
          surface: "APP",
          summonedSide: null,
          interactionsView: "overview",
        };
      }
      if (action.target === "SPACE") {
        return { ui: "SURFACE", surface: "SPACE", summonedSide: null, interactionsView: "overview" };
      }
      if (launchTargetIsSurface(action.target)) {
        return { ui: "SURFACE", surface: action.target, summonedSide: null, interactionsView: "overview" };
      }
      return model;
    }
    case "DISMISS_INTERACTION":
      return { ui: restUi(model.surface), surface: model.surface, summonedSide: null, interactionsView: "overview" };
    case "OPEN_COMMENTS":
      return { ...model, ui: "INTERACTION", surface: "APP", summonedSide: null, interactionsView: "comments" };
    case "CLOSE_COMMENTS":
      return { ...model, ui: "INTERACTION", surface: "APP", summonedSide: null, interactionsView: "overview" };
    case "SET_SURFACE": {
      const dest = normalizeHomeDestination(action.surface);
      if (dest === "APP") {
        return { ui: "HOME", surface: "APP", summonedSide: null, interactionsView: "overview" };
      }
      return { ui: "SURFACE", surface: dest, summonedSide: null, interactionsView: "overview" };
    }
    default:
      return model;
  }
}

export function modelToHomeNav(model: CreatorSpaceModel): HomeNavSnapshot {
  const nav = initialHomeNav(model.surface);
  return {
    ...nav,
    active: model.surface,
    interactionsOpen: model.ui === "INTERACTION",
    interactionsView: model.interactionsView,
  };
}

export function modelFromHomeNav(nav: HomeNavSnapshot): CreatorSpaceModel {
  if (nav.interactionsOpen) {
    return { ui: "INTERACTION", surface: nav.active === "SPACE" ? "APP" : nav.active, summonedSide: null, interactionsView: nav.interactionsView };
  }
  if (nav.active === "APP") {
    return { ui: "HOME", surface: "APP", summonedSide: null, interactionsView: "overview" };
  }
  return { ui: "SURFACE", surface: nav.active, summonedSide: null, interactionsView: "overview" };
}

export function launchTargetIsOverlay(target: string): boolean {
  return target === "INTERACTIONS";
}

export function launchTargetIsSurface(target: string): target is CreatorMediaSurface {
  return CREATOR_MEDIA_SURFACES.includes(target as CreatorMediaSurface);
}
