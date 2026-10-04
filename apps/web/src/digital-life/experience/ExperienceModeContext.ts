import { createContext, useContext } from "react";
import type { ExperienceMode } from "./experienceMode";

export const ExperienceModeContext = createContext<ExperienceMode>("APP");

export function useExperienceMode(): ExperienceMode {
  return useContext(ExperienceModeContext);
}
