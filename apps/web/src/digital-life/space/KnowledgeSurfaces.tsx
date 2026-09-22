import type { PublicBrandExperience } from "@mybrandos/shared";
import { DigipediaScreen } from "../digipedia/DigipediaScreen";
import { NewsScreen } from "../news/NewsScreen";

export function DigiPediaSurface({
  experience,
  mediaBase,
  basePath,
}: {
  experience: PublicBrandExperience;
  mediaBase: string;
  basePath: string;
}) {
  return <DigipediaScreen experience={experience} mediaBase={mediaBase} basePath={basePath} />;
}

export function DigiNewsSurface({
  experience,
  mediaBase,
}: {
  experience: PublicBrandExperience;
  mediaBase: string;
}) {
  return <NewsScreen experience={experience} mediaBase={mediaBase} />;
}
