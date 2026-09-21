import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  closeHomeInteractions,
  closeHomeSpace,
  homeNavEquals,
  initialHomeNav,
  normalizeHomeDestination,
  openHomeComments,
  openHomeInteractions,
  openHomeSpace,
  spaceSurfaceLifecycle,
  stationModeFromSurface,
  swapHomeSlot,
  type CreatorSpaceRuntime,
  type CreatorSpaceSurface,
  type HomeNavSnapshot,
  type HomeSlotId,
  type HomeSlotOccupant,
  type PublicStationMode,
  type StationRuntimeLifecycle,
  type SwapDestination,
} from "@mybrandos/shared";

type CreatorSpaceApi = {
  surface: CreatorSpaceSurface;
  previous: CreatorSpaceSurface | null;
  slots: Record<HomeSlotId, HomeSlotOccupant>;
  routerOpen: boolean;
  interactionsOpen: boolean;
  interactionsView: "overview" | "comments";
  controlsHidden: boolean;
  setSurface: (surface: CreatorSpaceSurface) => void;
  selectSlot: (slot: HomeSlotId) => void;
  openSpace: () => void;
  closeSpace: () => void;
  openInteractions: () => void;
  closeInteractions: () => void;
  openComments: () => void;
  closeComments: () => void;
  toggleControls: () => void;
  setRouterOpen: (open: boolean) => void;
  lifecycle: (candidate: CreatorSpaceSurface) => CreatorSpaceRuntime;
};

const CreatorSpaceContext = createContext<CreatorSpaceApi | null>(null);

function storageKey(slug: string) {
  return `mybrandos-space-surface:${slug}`;
}

function slotsKey(slug: string) {
  return `mybrandos-home-slots:${slug}`;
}

function readStoredNav(slug: string, initialSurface: CreatorSpaceSurface): HomeNavSnapshot {
  const requested = normalizeHomeDestination(initialSurface);
  if (requested !== "APP") return initialHomeNav(requested);
  if (typeof sessionStorage === "undefined") return initialHomeNav("APP");
  try {
    const rawSlots = sessionStorage.getItem(slotsKey(slug));
    const rawActive = sessionStorage.getItem(storageKey(slug));
    const active = normalizeHomeDestination(rawActive, "APP");
    const fallback = initialHomeNav(active);
    if (!rawSlots) return fallback;
    const parsed = JSON.parse(rawSlots) as Record<HomeSlotId, HomeSlotOccupant>;
    return { ...fallback, slots: { ...fallback.slots, ...parsed } };
  } catch {
    return initialHomeNav("APP");
  }
}

function persistNav(slug: string, snapshot: HomeNavSnapshot) {
  try {
    const storedActive: SwapDestination =
      snapshot.active === "SPACE" ? snapshot.returnFromSpace || "APP" : (snapshot.active as SwapDestination);
    sessionStorage.setItem(storageKey(slug), storedActive);
    sessionStorage.setItem(slotsKey(slug), JSON.stringify(snapshot.slots));
  } catch {
    /* private mode */
  }
}

function historyPayload(snapshot: HomeNavSnapshot) {
  return { ...(typeof history === "undefined" ? {} : (history.state as object | null) || {}), homeNav: snapshot };
}

export function CreatorSpaceProvider({
  slug,
  initialSurface = "APP",
  children,
}: {
  slug: string;
  initialSurface?: CreatorSpaceSurface;
  children: ReactNode;
}) {
  const [nav, setNav] = useState<HomeNavSnapshot>(() => readStoredNav(slug, initialSurface));
  const [previous, setPrevious] = useState<CreatorSpaceSurface | null>(null);
  const [controlsHidden, setControlsHidden] = useState(false);
  const navRef = useRef(nav);
  navRef.current = nav;
  const skipPop = useRef(false);

  const apply = useCallback(
    (next: HomeNavSnapshot, mode: "push" | "replace" | "silent") => {
      const current = navRef.current;
      if (homeNavEquals(current, next)) return;
      setPrevious(current.active);
      setNav(next);
      persistNav(slug, next);
      if (typeof history === "undefined") return;
      if (mode === "push") history.pushState(historyPayload(next), "");
      if (mode === "replace") history.replaceState(historyPayload(next), "");
    },
    [slug],
  );

  useEffect(() => {
    const next = readStoredNav(slug, initialSurface);
    skipPop.current = true;
    setPrevious(null);
    setNav(next);
    persistNav(slug, next);
    if (typeof history !== "undefined") history.replaceState(historyPayload(next), "");
    skipPop.current = false;
  }, [slug, initialSurface]);

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      if (skipPop.current) return;
      const incoming = (event.state as { homeNav?: HomeNavSnapshot } | null)?.homeNav;
      if (!incoming) {
        setNav(initialHomeNav(normalizeHomeDestination(initialSurface)));
        return;
      }
      setPrevious(navRef.current.active);
      setNav(incoming);
      persistNav(slug, incoming);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [slug, initialSurface]);

  const selectSlot = useCallback(
    (slot: HomeSlotId) => {
      const current = navRef.current;
      if (current.slots[slot] === "INTERACTIONS") {
        apply(
          current.interactionsOpen ? closeHomeInteractions(current) : openHomeInteractions(current),
          "push",
        );
        return;
      }
      const next = swapHomeSlot(current, slot);
      if (!next) return;
      apply(next, "push");
    },
    [apply],
  );

  const setSurface = useCallback(
    (surface: CreatorSpaceSurface) => {
      const dest = normalizeHomeDestination(surface);
      const current = navRef.current;
      if (dest === "SPACE") {
        apply(openHomeSpace(current), current.active === "SPACE" ? "silent" : "push");
        return;
      }
      if (dest === current.active) return;
      const slot = (Object.keys(current.slots) as HomeSlotId[]).find((id) => current.slots[id] === dest);
      if (slot) {
        const next = swapHomeSlot(current, slot);
        if (next) apply(next, "push");
        return;
      }
      apply({ ...current, active: dest, returnFromSpace: null, interactionsOpen: false, interactionsView: "overview" }, "push");
    },
    [apply],
  );

  const value = useMemo<CreatorSpaceApi>(
    () => ({
      surface: nav.active,
      previous,
      slots: nav.slots,
      routerOpen: nav.active === "SPACE",
      interactionsOpen: nav.interactionsOpen,
      interactionsView: nav.interactionsView,
      controlsHidden,
      setSurface,
      selectSlot,
      openSpace: () => {
        const current = navRef.current;
        if (current.active === "SPACE") apply(closeHomeSpace(current), "push");
        else apply(openHomeSpace(current), "push");
      },
      closeSpace: () => apply(closeHomeSpace(navRef.current), "push"),
      openInteractions: () => {
        const current = navRef.current;
        apply(openHomeInteractions(current), current.interactionsOpen ? "silent" : "push");
      },
      closeInteractions: () => apply(closeHomeInteractions(navRef.current), "push"),
      openComments: () => {
        const current = navRef.current;
        apply(openHomeComments(current), current.interactionsView === "comments" ? "silent" : "push");
      },
      closeComments: () => apply(openHomeInteractions(navRef.current), "push"),
      toggleControls: () => setControlsHidden((v) => !v),
      setRouterOpen: (open) => {
        const current = navRef.current;
        if (open) apply(openHomeSpace(current), current.active === "SPACE" ? "silent" : "push");
        else apply(closeHomeSpace(current), "push");
      },
      lifecycle: (candidate) => spaceSurfaceLifecycle(nav.active, candidate, previous),
    }),
    [nav, previous, controlsHidden, setSurface, selectSlot, apply],
  );

  return <CreatorSpaceContext.Provider value={value}>{children}</CreatorSpaceContext.Provider>;
}

export function useCreatorSpace(): CreatorSpaceApi {
  const ctx = useContext(CreatorSpaceContext);
  if (!ctx) {
    const fallback = initialHomeNav("APP");
    return {
      surface: "APP",
      previous: null,
      slots: fallback.slots,
      routerOpen: false,
      interactionsOpen: false,
      interactionsView: "overview",
      controlsHidden: false,
      setSurface: () => undefined,
      selectSlot: () => undefined,
      openSpace: () => undefined,
      closeSpace: () => undefined,
      openInteractions: () => undefined,
      closeInteractions: () => undefined,
      openComments: () => undefined,
      closeComments: () => undefined,
      toggleControls: () => undefined,
      setRouterOpen: () => undefined,
      lifecycle: (candidate) => (candidate === "APP" ? "ACTIVE" : "SUSPENDED"),
    };
  }
  return ctx;
}

/** Station TV/Radio still read this; surface is the source of truth. */
export function useStationModeFromSpace(): {
  mode: PublicStationMode;
  previous: PublicStationMode | null;
  setMode: (mode: PublicStationMode) => void;
  lifecycle: (candidate: PublicStationMode) => StationRuntimeLifecycle;
} {
  const space = useCreatorSpace();
  const mode = stationModeFromSurface(space.surface);
  const previous = space.previous ? stationModeFromSurface(space.previous) : null;
  return {
    mode,
    previous,
    setMode: (next) => space.setSurface(next === "TV" ? "TV" : next === "RADIO" ? "RADIO" : "APP"),
    lifecycle: (candidate) => {
      const surface: CreatorSpaceSurface = candidate === "TV" ? "TV" : candidate === "RADIO" ? "RADIO" : "APP";
      return space.lifecycle(surface);
    },
  };
}
