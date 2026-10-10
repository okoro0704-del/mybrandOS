import type { CreatorSpaceSurface } from "@mybrandos/shared";

/** The five deliverables of a creator's Space, in Switch order. "APP" is the Space home. */
export const SPACE_DELIVERABLES = ["APP", "DIGIPEDIA", "NEWS", "TV", "RADIO"] as const;
export type SpaceDeliverable = (typeof SPACE_DELIVERABLES)[number];

export const SPACE_DELIVERABLE_LABEL: Record<SpaceDeliverable, string> = {
  APP: "Space",
  DIGIPEDIA: "Digipedia",
  NEWS: "DigiNews",
  TV: "TV",
  RADIO: "Radio",
};

export function deliverableOf(surface: CreatorSpaceSurface): SpaceDeliverable {
  return (SPACE_DELIVERABLES as readonly string[]).includes(surface) ? (surface as SpaceDeliverable) : "APP";
}

/** Each tap of Switch moves to the next deliverable and wraps around. */
export function nextSpaceDeliverable(surface: CreatorSpaceSurface): SpaceDeliverable {
  const index = SPACE_DELIVERABLES.indexOf(deliverableOf(surface));
  return SPACE_DELIVERABLES[(index + 1) % SPACE_DELIVERABLES.length]!;
}
