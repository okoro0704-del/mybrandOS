import { createContext, useContext } from "react";
import type { RevealChromeState } from "./revealChrome";

export type RevealChromeApi = {
  state: RevealChromeState;
  navVisible: boolean;
  wordmarkVisible: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  selectDestination: () => void;
};

export const RevealChromeContext = createContext<RevealChromeApi | null>(null);

export function useRevealChrome(): RevealChromeApi | null {
  return useContext(RevealChromeContext);
}
