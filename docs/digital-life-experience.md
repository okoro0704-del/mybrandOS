# Digital Life Experience Layer

## Product definitions

> **LifeOS** is the gateway to the digital economy.

> **mybrandOS** is the operating environment for a Digital Life.

> **The public App** is how people experience the creator.

> **The Website** is how people get official information from the creator.

> **The Workstation** is how the creator builds and operates the Digital Life.

> **One Digital Life powers all three surfaces.**

> **One Digital Life can have multiple experiences without becoming multiple systems.**

This layer is an **application/presentation** concern. It is **not** a LifeOS primitive.

## Three surfaces

```text
ONE DIGITAL LIFE
├── Public App Experience   (/u/:slug)           — experience / discover / watch / listen / buy
├── Public Website          (/u/:slug/website)   — inform / news / about / press / contact
└── Private Workstation     (/)                  — create / produce / manage / sell
```

All three read the same underlying records:

- `PersonalSpace` — identity, brand, slug, theme, website page config
- `Asset` — published creative work (`status=PUBLISHED` + `visibility=public`)
- Offers / Live sessions / messaging bindings as already modeled

Do **not** create `PublicAsset`, `WebsiteAsset`, `PublicFeedBackend`, or a second CMS.

## Public App

- Adaptive navigation from `DEFAULT_APP_NAV` (hides empty collections unless `alwaysShow`)
- Brand-first app shell: sticky top bar, mobile bottom nav (Home / Assets / Website / Profile)
- Home: branded hero + featured + latest + type sections + live + offers (content-first, no Workstation metrics)
- Assets: searchable / filterable published library
- Profile: brand identity + public links (+ owner Workstation link in preview only)
- Feed / media collections / Store / Live remain available as contextual routes
- Media collections: Videos, Music, Books, Courses, Writing, Software
- Store: ACTIVE offers only; checkout via FundzMan when bound
- Live: honest `LIVE` or `live_provider_unavailable`
- Installable PWA with per-slug manifest + shell service worker (see `docs/branded-digital-life-app.md`)

## Public Website

- Structured pages stored as `PersonalSpace.websitePages` JSON (presentation config)
- Types: ABOUT, NEWS, ARTICLE, PRESS, EVENT, CONTACT, CUSTOM_INFORMATION
- Status: DRAFT (owner only) | PUBLISHED (visitors)
- Owner manages pages at `/website`
- Preview at `/brand/preview/website`
- Public at `/u/:slug/website` and `/u/:slug/website/:pageSlug`

## Workstation

- Full operating environment (Assets, Create, Recording, Production, Live, Commerce, Brand, Website, …)
- Owner surface switcher: **Workstation · My Digital Life · Website**
- Publishing remains explicit — never auto-public

## Visibility

Only `PUBLISHED` + `visibility=public` Assets appear to anonymous visitors.

Draft website pages never appear on the public Website.

Private DataZone IDs, collaborator data, and owner controls stay off public projections (`assertPublicProjection`).

## LifeOS / OS Shell

- LifeOS discovers and routes into creator Digital Lives.
- OS Shell may launch mybrandOS; it does not own Digital Life content.
- mybrandOS does not duplicate LifeOS.

## Recording / Production

```text
Recording / Production → Asset → Publish → Public App
Website News → announce the release
```

## Security

- Public routes cannot escalate to Workstation access
- Software public surface never exposes private source
- FundzMan credentials never enter public payloads
- Analytics are not invented (`analytics_unavailable` when unbound)
