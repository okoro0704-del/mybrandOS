import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type OsState = {
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
};

const OsContext = createContext<OsState | null>(null);

export function OsProvider({ children }: { children: ReactNode }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const value = useMemo(() => ({ moreOpen, setMoreOpen }), [moreOpen]);
  return <OsContext.Provider value={value}>{children}</OsContext.Provider>;
}

export function useOs() {
  const ctx = useContext(OsContext);
  if (!ctx) throw new Error("useOs must be used inside OsProvider");
  return ctx;
}
