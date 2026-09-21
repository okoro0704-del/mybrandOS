import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { PublicAssetCard } from "@mybrandos/shared";

type HomeExperienceApi = {
  asset: PublicAssetCard | null;
  setAsset: (asset: PublicAssetCard | null) => void;
};

const HomeExperienceContext = createContext<HomeExperienceApi | null>(null);

export function HomeExperienceProvider({ children }: { children: ReactNode }) {
  const [asset, setAsset] = useState<PublicAssetCard | null>(null);
  const value = useMemo(() => ({ asset, setAsset }), [asset]);
  return <HomeExperienceContext.Provider value={value}>{children}</HomeExperienceContext.Provider>;
}

export function useHomeExperience(): HomeExperienceApi {
  const ctx = useContext(HomeExperienceContext);
  if (!ctx) return { asset: null, setAsset: () => undefined };
  return ctx;
}
