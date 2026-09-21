import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  isCreatorSpaceSurface,
  spaceSurfaceLifecycle,
  stationModeFromSurface,
  type CreatorSpaceRuntime,
  type CreatorSpaceSurface,
  type PublicStationMode,
  type StationRuntimeLifecycle,
} from "@mybrandos/shared";

type CreatorSpaceApi = {
  surface: CreatorSpaceSurface;
  previous: CreatorSpaceSurface | null;
  routerOpen: boolean;
  setSurface: (surface: CreatorSpaceSurface) => void;
  setRouterOpen: (open: boolean) => void;
  lifecycle: (candidate: CreatorSpaceSurface) => CreatorSpaceRuntime;
};

const CreatorSpaceContext = createContext<CreatorSpaceApi | null>(null);

function storageKey(slug: string) {
  return `mybrandos-space-surface:${slug}`;
}

function readStored(slug: string, fallback: CreatorSpaceSurface): CreatorSpaceSurface {
  if (typeof sessionStorage === "undefined") return fallback;
  try {
    const raw = sessionStorage.getItem(storageKey(slug));
    return isCreatorSpaceSurface(raw) ? raw : fallback;
  } catch {
    return fallback;
  }
}

function resolveSurface(slug: string, initialSurface: CreatorSpaceSurface): CreatorSpaceSurface {
  if (initialSurface !== "APP") return initialSurface;
  return readStored(slug, "APP");
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
  const [surface, setSurfaceState] = useState<CreatorSpaceSurface>(() => resolveSurface(slug, initialSurface));
  const [previous, setPrevious] = useState<CreatorSpaceSurface | null>(null);
  const [routerOpen, setRouterOpen] = useState(false);

  useEffect(() => {
    setSurfaceState(resolveSurface(slug, initialSurface));
    setPrevious(null);
    setRouterOpen(false);
  }, [slug, initialSurface]);

  const setSurface = useCallback((next: CreatorSpaceSurface) => {
    setRouterOpen(false);
    setSurfaceState((current) => {
      if (current === next) return current;
      setPrevious(current);
      try {
        sessionStorage.setItem(storageKey(slug), next);
      } catch {
        /* private mode */
      }
      return next;
    });
  }, [slug]);

  const value = useMemo<CreatorSpaceApi>(
    () => ({
      surface,
      previous,
      routerOpen,
      setSurface,
      setRouterOpen,
      lifecycle: (candidate) => spaceSurfaceLifecycle(surface, candidate, previous),
    }),
    [surface, previous, routerOpen, setSurface],
  );

  return <CreatorSpaceContext.Provider value={value}>{children}</CreatorSpaceContext.Provider>;
}

export function useCreatorSpace(): CreatorSpaceApi {
  const ctx = useContext(CreatorSpaceContext);
  if (!ctx) {
    return {
      surface: "APP",
      previous: null,
      routerOpen: false,
      setSurface: () => undefined,
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
      const runtime = space.lifecycle(surface);
      return runtime;
    },
  };
}
