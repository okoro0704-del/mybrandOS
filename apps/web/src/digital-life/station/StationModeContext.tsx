import type { ReactNode } from "react";
import { CreatorSpaceProvider, useStationModeFromSpace } from "../space/CreatorSpaceContext";

export function StationModeProvider({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  return <CreatorSpaceProvider slug={slug}>{children}</CreatorSpaceProvider>;
}

export function useStationMode() {
  return useStationModeFromSpace();
}
