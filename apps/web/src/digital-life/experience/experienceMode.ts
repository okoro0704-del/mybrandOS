/** Presentation is selected explicitly; a route, media element, or hidden control is never Space evidence. */
export const EXPERIENCE_MODES = ["APP", "SPACE"] as const;
export type ExperienceMode = (typeof EXPERIENCE_MODES)[number];
export function isSpaceExperience(mode: ExperienceMode): boolean { return mode === "SPACE"; }
export function nextExperienceMode(_current: ExperienceMode, target: ExperienceMode): ExperienceMode { return target; }
