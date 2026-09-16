import { createContext, useContext } from "react";
import type { HomeChromeState } from "./homeChrome";

/** null = chrome controller inactive (non-Home surfaces). */
export const HomeChromeContext = createContext<HomeChromeState | null>(null);

export function useHomeChromeState(): HomeChromeState | null {
  return useContext(HomeChromeContext);
}
