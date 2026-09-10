# Branded Digital Life App

## Mission

The public Digital Life is a **consumer application**, not a dashboard and not a clone of the Workstation.

Visitors should feel:

> “I am inside this person's Digital Life.”

Brand name, logo, theme, icons, title, and install metadata replace generic mybrandOS chrome.

## One Digital Life — three surfaces

```text
ONE DIGITAL LIFE
        │
        ├── Public App      /u/:slug            EXPERIENCE
        ├── Website         /u/:slug/website    INFORMATION
        └── Workstation     /                   OPERATE
```

All three use the same underlying records:

- `PersonalSpace` / Brand
- `Asset` (published + public only on public surfaces)
- Offers / Live / website page config

Do **not** create `PublicAsset`, `DigitalLifeAsset`, `AppAsset`, `ConsumerContentDB`, `PublicFeedBackend`, `WebsiteCMSBackend`, `PWADataBackend`, or a second checkout/search/auth system.

## Public App navigation

Primary destinations:

| Destination | Path |
|---|---|
| Home | `/u/:slug` |
| Favorites | `/u/:slug/favorites` |
| Management | `/u/:slug/management` |
| Communities | `/u/:slug/communities` |
| Website | `/u/:slug/website` |
| Asset detail | `/u/:slug/a/:assetId` |

Mobile bottom nav: **Home · Favorites · Management · Communities · Website**.

Home opens on published assets immediately. Adaptive specialty chips (Posts, Videos, Reels, Audio, Podcasts, Books, …) appear only for categories the creator publishes, ordered by volume.

Favorites ranks published Assets by existing `Asset.analytics` engagement (views/plays) — no separate social/trending backend.

## Brand-first chrome

- Document title uses brand name
- Theme color / favicon / apple-touch-icon from brand when available
- Per-slug PWA manifest: `GET /api/public/:slug/manifest.webmanifest`
- Fallback icons: `/icons/digital-life-192.svg`, `/icons/digital-life-512.svg`

## PWA / install

- Service worker: `/sw-digital-life.js` (shell + static only; never private API)
- Chromium: real `beforeinstallprompt`
- iOS: honest Share → Add to Home Screen guidance
- Dismissal remembered per slug
- Standalone mode hides install chrome

## Boundaries

| Public App may show | Must stay private |
|---|---|
| Published assets | Drafts / private assets |
| Published website pages | Collaborators / projects |
| Active live + offers | Workstation ops / processing |
| Brand profile + public links | Settings / Command Center |

Commerce checkout remains FundzMan. Payments unavailable stays honest: `payments_unavailable`.

## Digiconomy / OS Shell

- Digiconomy Marketplace is a **future separate product** — not implemented here.
- OS Shell may launch mybrandOS; it does not own Digital Life content.

## Implementation map

```text
apps/web/src/digital-life/
  routes.ts
  branding.ts
  shell/
  navigation/
  install/
  pwa/
apps/web/src/experience/ExperienceView.tsx   — Home / Assets / Profile / media
apps/web/public/sw-digital-life.js
apps/api/src/routes/public.ts                — manifest.webmanifest
```
