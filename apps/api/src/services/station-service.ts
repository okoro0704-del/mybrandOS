import type { PrimitiveBindings } from "@mybrandos/integrations";
import { buildPublicStation, type PublicStationExperience } from "@mybrandos/shared";
import { getPublicBrandExperience } from "./brand-service.js";

export async function getPublicStation(
  slug: string,
  primitives?: PrimitiveBindings,
): Promise<PublicStationExperience> {
  const experience = await getPublicBrandExperience(slug, primitives);
  return buildPublicStation({
    slug: experience.slug,
    assets: experience.publishedAssets,
    liveNow: experience.liveNow,
    owner: experience.presentation?.station,
  });
}
