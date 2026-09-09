# mybrandOS Architecture — Phase 1

mybrandOS is the Gateway to a person's Digital Life. It is an operating system kernel, not a social network, creator dashboard, website builder, course platform, or CRM.

## Principle

Everything revolves around **Assets**. An Asset is any digital item a person owns, creates, imports, manages, publishes, distributes, or monetizes.

- Origin is metadata.
- Origin never limits capability.
- Imported assets are first-class.

Studios (books, courses, music, video, software, AI creation) are **not** built in this phase.

## Folder architecture

```
mybrandOS/
├── apps/
│   ├── api/                 # Fastify OS kernel
│   │   ├── prisma/          # Asset schema + seed
│   │   └── src/
│   │       ├── routes/      # Auth, assets, import, create, gateway
│   │       ├── services/    # Asset, import, create, home/command
│   │       └── lib/         # Session, Prisma, JSON
│   └── web/                 # Vite + React shell
│       └── src/
│           ├── components/  # OS chrome
│           ├── nav/         # Icons
│           ├── pages/       # Screens 1–8 + system
│           └── state/       # Identity, assets, shell
├── packages/
│   ├── shared/              # Types, enums, navigation
│   └── integrations/        # Trust ID, DataZone, ElfCom, FundzMan, Distribution
└── docs/
```

## Database schema

SQLite locally (`file:./dev.db`). Swap `provider` to `postgresql` for production.

Core tables: `Asset`, `Session`, `Activity`, `ImportJob`, `CreationProject`, `PersonalSpace`, `AudienceSegment`, `CommerceItem`.

Asset fields match the required model: `id`, `ownerId`, `title`, `description`, `assetType`, `origin`, `status`, `createdAt`, `updatedAt`, `dataZoneId`, `metadata`, `relationships`, `analytics`, `commerce`, `distribution`, `visibility`.

Enums:

- Origin: `CREATED_INTERNAL | IMPORTED_FILE | IMPORTED_URL | IMPORTED_EXTERNAL`
- Status: `DRAFT | PUBLISHED | ARCHIVED`

JSON columns are stored as strings on SQLite and parsed at the service boundary.

## Asset service & APIs

`AssetService` is the only write path for native assets. Import and Create both call it.

| Method | Path | Purpose |
|---|---|---|
| GET | `/assets` | Search, filter, sort |
| GET | `/assets/summary` | Library counts |
| GET | `/assets/:id` | Detail |
| POST | `/assets` | Create native asset |
| PATCH | `/assets/:id` | Update including status |
| POST | `/import/file` | File upload → DataZone → native asset |
| POST | `/import/folder` | Folder upload |
| POST | `/import/url` | URL import |
| POST | `/import/external` | External source import |
| POST | `/create/projects` | Launcher (no editors) |
| GET | `/home` | Digital Life Gateway |
| GET | `/command-center` | Attention |
| GET | `/personal-space` | Published assets + profile |
| GET | `/audience` | Structure |
| GET | `/commerce` | Structure |

## Navigation

Primary: Home, Create, Assets, Audience, Commerce  
Secondary: Personal Space, ElfCom, Analytics, Money, Distribution, AI, Settings

Desktop uses a left rail. Mobile uses a bottom dock + More sheet.

## State management

Three React context stores — no duplicated backend state:

- `IdentityProvider` — Trust ID session
- `AssetProvider` — library query + mutations
- `OsProvider` — shell chrome (More sheet)

The API remains the source of truth. Stores are view-state + fetch caches.

## Integration layers

mybrandOS never embeds Trust ID, DataZone, ElfCom, FundzMan, or Distribution. It binds adapters:

| Primitive | Local (dev) | Remote |
|---|---|---|
| Trust ID | `LocalTrustIdAdapter` | OAuth PKCE + `/oauth/userinfo` |
| DataZone | in-memory object ids | BaaS upload-intent + complete |
| ElfCom | placeholder inbox | `/v1/inbox`, `/v1/notify` |
| FundzMan | zeroed wallet | `/v1/wallet/:id/summary` |
| Distribution | local opportunities | release/publish requests |

Set `PRIMITIVES_MODE=remote` and the matching URLs to bind live engines.

## Mobile responsive architecture

- `100dvh` + safe-area insets
- Bottom dock for the five primary destinations
- More sheet for secondary system surfaces
- Single-column collapse under 640px
- Touch targets ≥ 42px
- No hover-only actions
