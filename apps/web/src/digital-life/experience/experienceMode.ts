/** Presentation is selected explicitly; a route, media element, or hidden control is never Space evidence. */
export const EXPERIENCE_MODES = ["APP", "SPACE"] as const;
export type ExperienceMode = (typeof EXPERIENCE_MODES)[number];
export function isSpaceExperience(mode: ExperienceMode): boolean { return mode === "SPACE"; }

/**
 * APP is sealed: nothing inside the APP (network loss, media failure, TV, Radio, More) may promote it to SPACE.
 * Only the external SPACE entry starts SPACE; SPACE may hand back to APP.
 */
export function nextExperienceMode(current: ExperienceMode, target: ExperienceMode): ExperienceMode {
  if (current === "APP") return "APP";
  return target;
}

/** OS Xperience chooses the execution environment. `?entry=space` is the only SPACE entry; everything else is APP. */
export const SPACE_ENTRY_PARAM = "entry";
export const SPACE_ENTRY_VALUE = "space";

export function resolveEntryExecutionMode(search: string | URLSearchParams | null | undefined): ExperienceMode {
  if (!search) return "APP";
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get(SPACE_ENTRY_PARAM)?.toLowerCase() === SPACE_ENTRY_VALUE ? "SPACE" : "APP";
}
