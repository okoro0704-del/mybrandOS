import type { PublicComment } from "../digital-life/personal-os/PostComments";

/** Development-only conversation fixtures. Never imported by production UI. */
export const LIVING_GALLERY_DEV_FIXTURES = {
  empty: [] as PublicComment[],
  one: [
    {
      id: "fix_one",
      body: "This is beautiful.",
      displayName: "Ada",
      createdAt: "2026-09-19T10:00:00.000Z",
      mine: false,
    },
  ] satisfies PublicComment[],
  many: Array.from({ length: 20 }, (_, i) => ({
    id: `fix_many_${i + 1}`,
    body: i === 7 ? "A very long comment that must remain readable for its full length before any auto-advance, because cutting it mid-sentence would fail the living conversation rule.".repeat(1) : `Comment ${i + 1} from the gallery.`,
    displayName: ["Ada", "Tobi", "Chi", "Kemi", "Jay"][i % 5]!,
    createdAt: new Date(Date.parse("2026-09-19T10:00:00.000Z") + i * 60_000).toISOString(),
    mine: false,
  })) satisfies PublicComment[],
  longCaption:
    "This caption is intentionally long so the living gallery must clamp it on first view and keep the full canonical text behind More, without consuming the entire initial viewport or covering the media frame.",
};
