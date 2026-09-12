# Creator-aware Public Experience

## Purpose

**mybrandOS Public App** is the experience of a specific creator's Digital Life.

Visitors should feel they entered that person's world — not a generic CMS dashboard.

## Surfaces (unchanged)

| Surface | Job |
|---|---|
| Public App | Experience the creator |
| Website | Official information |
| Workstation | Build and operate |

Creator-aware section bars and sticky landing belong to the **Public App**.

## Deterministic ranking

```text
Creator preference (presentationConfig)
        ↓
Creator specialty (override → brand copy → published mix)
        ↓
Published availability (empty sections hidden)
        ↓
Sticky landing (hero + continue exploring)
```

No recommendation backend. No fake engagement. No seventh primitive.

## Key contracts

- `PublicExperiencePresentation` — owner preference on PersonalSpace (`presentationConfig`)
- `buildStickyLandingPlan` — primary chip, sections, hero, continue lanes
- `specialtyChipsFor` — creator-aware order; empty categories omitted
- `favoritesDiscoveryLanes` — visitor discovery (engagement when real, else recency)

## Favorites vs creator landing

| | Creator Public App | Favorites / Discovery |
|---|---|---|
| Question | What should this creator show first? | What should I experience now? |
| Signals | Identity, preference, specialty, published work | Engagement, recency, live |

## LifeOS relationship

Horizontal section-bar philosophy matches LifeOS mobile (Post / Reels / Products / …) but sections and order are **creator-aware**.

## Owner controls

Brand → “Creator-aware public landing”:

- Primary experience chip
- Creator type hint
- Prefer featured Assets in hero

Preference never surfaces unavailable content.
