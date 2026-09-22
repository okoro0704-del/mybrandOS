import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  LAUNCHER_IDLE_MS,
  initialCreatorSpaceModel,
  initialHomeNav,
  modelFromHomeNav,
  modelToHomeNav,
  normalizeHomeDestination,
  reduceCreatorSpace,
  spaceSurfaceLifecycle,
  stationModeFromSurface,
  type CreatorSpaceModel,
  type CreatorSpaceRuntime,
  type CreatorSpaceSurface,
  type CreatorSpaceUiState,
  type EdgeLauncherSide,
  type HomeSlotId,
  type HomeSlotOccupant,
  type LaunchTarget,
  type PublicStationMode,
  type StationRuntimeLifecycle,
} from "@mybrandos/shared";

type CreatorSpaceApi = {
  ui: CreatorSpaceUiState;
  surface: CreatorSpaceSurface;
  previous: CreatorSpaceSurface | null;
  slots: Record<HomeSlotId, HomeSlotOccupant>;
  routerOpen: boolean;
  interactionsOpen: boolean;
  interactionsView: "overview" | "comments";
  controlsHidden: boolean;
  revealed: EdgeLauncherSide | null;
  detailsOpen: boolean;
  setSurface: (surface: CreatorSpaceSurface) => void;
  selectSlot: (slot: HomeSlotId) => void;
  revealLauncher: (side: EdgeLauncherSide) => void;
  launch: (target: LaunchTarget) => void;
  collapseLaunchers: () => void;
  holdLaunchers: (held: boolean) => void;
  toggleDetails: () => void;
  closeDetails: () => void;
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

function readStoredModel(slug: string, initialSurface: CreatorSpaceSurface): CreatorSpaceModel {
  const requested = normalizeHomeDestination(initialSurface);
  if (requested !== "APP") return initialCreatorSpaceModel(requested);
  if (typeof sessionStorage === "undefined") return initialCreatorSpaceModel("APP");
  try {
    const rawActive = sessionStorage.getItem(storageKey(slug));
    return initialCreatorSpaceModel(normalizeHomeDestination(rawActive, "APP"));
  } catch {
    return initialCreatorSpaceModel("APP");
  }
}

function persistModel(slug: string, model: CreatorSpaceModel) {
  try {
    sessionStorage.setItem(storageKey(slug), model.surface === "SPACE" ? "APP" : model.surface);
  } catch {
    /* private mode */
  }
}

function historyPayload(model: CreatorSpaceModel) {
  return {
    ...(typeof history === "undefined" ? {} : (history.state as object | null) || {}),
    creatorSpace: model,
    homeNav: modelToHomeNav(model),
  };
}

const idleFallback: CreatorSpaceApi = {
  ui: "HOME",
  surface: "APP",
  previous: null,
  slots: initialHomeNav("APP").slots,
  routerOpen: false,
  interactionsOpen: false,
  interactionsView: "overview",
  controlsHidden: true,
  revealed: null,
  detailsOpen: false,
  setSurface: () => undefined,
  selectSlot: () => undefined,
  revealLauncher: () => undefined,
  launch: () => undefined,
  collapseLaunchers: () => undefined,
  holdLaunchers: () => undefined,
  toggleDetails: () => undefined,
  closeDetails: () => undefined,
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

export function CreatorSpaceProvider({
  slug,
  initialSurface = "APP",
  children,
}: {
  slug: string;
  initialSurface?: CreatorSpaceSurface;
  children: ReactNode;
}) {
  const [model, setModel] = useState<CreatorSpaceModel>(() => readStoredModel(slug, initialSurface));
  const [previous, setPrevious] = useState<CreatorSpaceSurface | null>(null);
  const [holdIdle, setHoldIdle] = useState(false);
  const modelRef = useRef(model);
  modelRef.current = model;
  const skipPop = useRef(false);

  const apply = useCallback(
    (next: CreatorSpaceModel, mode: "push" | "replace" | "silent") => {
      const current = modelRef.current;
      if (
        current.ui === next.ui &&
        current.surface === next.surface &&
        current.summonedSide === next.summonedSide &&
        current.interactionsView === next.interactionsView
      ) {
        return;
      }
      setPrevious(current.surface);
      setModel(next);
      persistModel(slug, next);
      if (typeof history === "undefined") return;
      if (mode === "push") history.pushState(historyPayload(next), "");
      if (mode === "replace") history.replaceState(historyPayload(next), "");
    },
    [slug],
  );

  const dispatch = useCallback(
    (action: Parameters<typeof reduceCreatorSpace>[1], mode: "push" | "replace" | "silent" = "push") => {
      apply(reduceCreatorSpace(modelRef.current, action), mode);
    },
    [apply],
  );

  useEffect(() => {
    const next = readStoredModel(slug, initialSurface);
    skipPop.current = true;
    setPrevious(null);
    setModel(next);
    persistModel(slug, next);
    if (typeof history !== "undefined") history.replaceState(historyPayload(next), "");
    skipPop.current = false;
  }, [slug, initialSurface]);

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      if (skipPop.current) return;
      const state = event.state as { creatorSpace?: CreatorSpaceModel; homeNav?: ReturnType<typeof modelToHomeNav> } | null;
      if (state?.creatorSpace) {
        setPrevious(modelRef.current.surface);
        setModel(state.creatorSpace);
        persistModel(slug, state.creatorSpace);
        return;
      }
      if (state?.homeNav) {
        const next = modelFromHomeNav(state.homeNav);
        setPrevious(modelRef.current.surface);
        setModel(next);
        persistModel(slug, next);
        return;
      }
      setModel(initialCreatorSpaceModel(normalizeHomeDestination(initialSurface)));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [slug, initialSurface]);

  useEffect(() => {
    if (model.ui !== "SUMMONED" || holdIdle) return;
    const t = window.setTimeout(() => dispatch({ type: "COLLAPSE" }, "silent"), LAUNCHER_IDLE_MS);
    return () => window.clearTimeout(t);
  }, [model.ui, model.summonedSide, holdIdle, dispatch]);

  const value = useMemo<CreatorSpaceApi>(
    () => ({
      ui: model.ui,
      surface: model.surface,
      previous,
      slots: initialHomeNav(model.surface).slots,
      routerOpen: model.surface === "SPACE",
      interactionsOpen: model.ui === "INTERACTION",
      interactionsView: model.interactionsView,
      controlsHidden: true,
      revealed: model.ui === "SUMMONED" ? model.summonedSide : null,
      detailsOpen: model.ui === "INTERACTION",
      setSurface: (surface) => dispatch({ type: "SET_SURFACE", surface }),
      selectSlot: () => undefined,
      revealLauncher: (side) => {
        if (modelRef.current.ui === "INTERACTION") {
          dispatch({ type: "DISMISS_INTERACTION" }, "silent");
          return;
        }
        dispatch({ type: "REVEAL", side }, "silent");
      },
      launch: (target) => dispatch({ type: "LAUNCH", target }),
      collapseLaunchers: () => dispatch({ type: "COLLAPSE" }, "silent"),
      holdLaunchers: setHoldIdle,
      toggleDetails: () => {
        if (modelRef.current.ui === "INTERACTION") dispatch({ type: "DISMISS_INTERACTION" });
        else dispatch({ type: "LAUNCH", target: "INTERACTIONS" });
      },
      closeDetails: () => dispatch({ type: "DISMISS_INTERACTION" }, "silent"),
      openSpace: () => dispatch({ type: "LAUNCH", target: "SPACE" }),
      closeSpace: () => dispatch({ type: "SET_SURFACE", surface: "APP" }),
      openInteractions: () => dispatch({ type: "LAUNCH", target: "INTERACTIONS" }),
      closeInteractions: () => dispatch({ type: "DISMISS_INTERACTION" }),
      openComments: () => dispatch({ type: "OPEN_COMMENTS" }, "silent"),
      closeComments: () => dispatch({ type: "CLOSE_COMMENTS" }, "silent"),
      toggleControls: () => dispatch({ type: "COLLAPSE" }, "silent"),
      setRouterOpen: (open) => dispatch(open ? { type: "LAUNCH", target: "SPACE" } : { type: "SET_SURFACE", surface: "APP" }),
      lifecycle: (candidate) => spaceSurfaceLifecycle(model.surface, candidate, previous),
    }),
    [model, previous, dispatch],
  );

  return <CreatorSpaceContext.Provider value={value}>{children}</CreatorSpaceContext.Provider>;
}

export function useCreatorSpace(): CreatorSpaceApi {
  return useContext(CreatorSpaceContext) ?? idleFallback;
}

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
