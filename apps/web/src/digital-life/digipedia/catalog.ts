export const DIGIPEDIA_SLOGAN = "KNOWLEDGE TURNS IDEAS INTO FREEDOM.";
export const DIGIPEDIA_CAPTION = "REAL KNOWLEDGE. REAL LIFE IMPACT.";
export const DIGIPEDIA_PILLARS = ["LEARN", "APPLY", "GROW", "BEYOND"] as const;
export const FEATURED_LADDER = ["IDEAS", "SKILLS", "OPPORTUNITIES", "FREEDOM"] as const;

export const DIGIPEDIA_CHIPS = ["All", "Business", "Mindset", "Money", "Tools", "Life"] as const;
export type DigipediaChip = (typeof DIGIPEDIA_CHIPS)[number];

export type DigipediaCardAccent = "green" | "purple" | "blue" | "cyan" | "violet" | "mint";

export type DigipediaCardId = "guides" | "insights" | "tools" | "strategies" | "mindset" | "opportunities";

export type DigipediaCardSpec = {
  id: DigipediaCardId;
  title: string;
  subtitle: string;
  chip: DigipediaChip;
  accent: DigipediaCardAccent;
  icon: "book" | "spark" | "wrench" | "compass" | "brain" | "orbit";
  keywords: string[];
};

export const DIGIPEDIA_CARDS: DigipediaCardSpec[] = [
  {
    id: "guides",
    title: "Guides",
    subtitle: "STEP-BY-STEP KNOWLEDGE",
    chip: "Business",
    accent: "green",
    icon: "book",
    keywords: ["guide", "step", "how", "tutorial", "playbook"],
  },
  {
    id: "insights",
    title: "Insights",
    subtitle: "IDEAS THAT CREATE CHANGE",
    chip: "Mindset",
    accent: "purple",
    icon: "spark",
    keywords: ["insight", "idea", "change", "think"],
  },
  {
    id: "tools",
    title: "Tools",
    subtitle: "RESOURCES I RECOMMEND",
    chip: "Tools",
    accent: "blue",
    icon: "wrench",
    keywords: ["tool", "resource", "recommend", "stack"],
  },
  {
    id: "strategies",
    title: "Strategies",
    subtitle: "REAL-WORLD PLAYBOOKS",
    chip: "Money",
    accent: "cyan",
    icon: "compass",
    keywords: ["strategy", "playbook", "money", "business"],
  },
  {
    id: "mindset",
    title: "Mindset",
    subtitle: "DISCIPLINE FOR A BIGGER YOU",
    chip: "Mindset",
    accent: "violet",
    icon: "brain",
    keywords: ["mindset", "discipline", "growth", "life"],
  },
  {
    id: "opportunities",
    title: "Opportunities",
    subtitle: "IDEAS. PEOPLE. POSSIBILITIES.",
    chip: "Life",
    accent: "mint",
    icon: "orbit",
    keywords: ["opportunity", "people", "possible", "freedom"],
  },
];

export type DigipediaSection = { id: string; heading: string; body: string };

export function filterCards(chip: DigipediaChip): DigipediaCardSpec[] {
  if (chip === "All") return DIGIPEDIA_CARDS;
  return DIGIPEDIA_CARDS.filter((card) => card.chip === chip);
}

export function matchSections(sections: DigipediaSection[], card: DigipediaCardSpec): DigipediaSection[] {
  return sections.filter((section) => {
    const hay = `${section.heading} ${section.body}`.toLowerCase();
    return card.keywords.some((word) => hay.includes(word));
  });
}

export function searchSections(sections: DigipediaSection[], query: string): DigipediaSection[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sections;
  return sections.filter(
    (section) => section.heading.toLowerCase().includes(needle) || section.body.toLowerCase().includes(needle),
  );
}
