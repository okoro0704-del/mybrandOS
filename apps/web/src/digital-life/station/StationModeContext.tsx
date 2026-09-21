import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  isPublicStationMode,
  stationLifecycle,
  type PublicStationMode,
  type StationRuntimeLifecycle,
} from "@mybrandos/shared";

type StationModeApi = {
  mode: PublicStationMode;
  previous: PublicStationMode | null;
  setMode: (mode: PublicStationMode) => void;
  lifecycle: (candidate: PublicStationMode) => StationRuntimeLifecycle;
};

const StationModeContext = createContext<StationModeApi | null>(null);

function storageKey(slug: string) {
  return `mybrandos-station-mode:${slug}`;
}

function readStored(slug: string): PublicStationMode {
  if (typeof sessionStorage === "undefined") return "APP";
  try {
    const raw = sessionStorage.getItem(storageKey(slug));
    return isPublicStationMode(raw) ? raw : "APP";
  } catch {
    return "APP";
  }
}

export function StationModeProvider({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  const [mode, setModeState] = useState<PublicStationMode>(() => readStored(slug));
  const [previous, setPrevious] = useState<PublicStationMode | null>(null);

  const setMode = useCallback((next: PublicStationMode) => {
    setModeState((current) => {
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

  const value = useMemo<StationModeApi>(
    () => ({
      mode,
      previous,
      setMode,
      lifecycle: (candidate) => stationLifecycle(mode, candidate, previous),
    }),
    [mode, previous, setMode],
  );

  return <StationModeContext.Provider value={value}>{children}</StationModeContext.Provider>;
}

export function useStationMode(): StationModeApi {
  const ctx = useContext(StationModeContext);
  if (!ctx) {
    return {
      mode: "APP",
      previous: null,
      setMode: () => undefined,
      lifecycle: (candidate) => (candidate === "APP" ? "ACTIVE" : "SUSPENDED"),
    };
  }
  return ctx;
}
