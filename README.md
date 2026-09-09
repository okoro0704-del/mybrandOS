# mybrandOS

**Gateway to a person's Digital Life.**

mybrandOS is a Digital Life Operating System. It is not a social network, creator dashboard, website builder, course platform, or CRM.

Phase 1 builds the operating-system foundation only: the shell, the universal asset kernel, and integration layers for existing LifeOS services.

## What this phase includes

- Home — Digital Life Gateway
- Universal asset library (search, filter, sort, group)
- Create launcher (no editors)
- Import engine (file, folder, URL, external source)
- Audience and Commerce structure
- Personal Space connected to published assets
- Command Center for attention
- Trust ID and DataZone integration layers
- ElfCom, FundzMan, and Distribution adapters

Studios for books, courses, software, music, video, and AI creation are **not** built yet.

## Principle

Everything revolves around **Assets**. Imported assets are first-class. Origin is metadata and never limits capability.

## Run locally

Requires Node 20+.

```bash
npm run setup
npm run dev
```

- Web: http://localhost:5176
- API: http://localhost:8793/health

On first entry, use **Enter with local identity**. That opens a Trust ID local adapter (`TD-LOCAL-MYBRANDOS`) so the OS can run before the live IdP is bound.

## Bind ecosystem services

Copy `.env.example` into `apps/api/.env` and switch:

```
PRIMITIVES_MODE=remote
TRUSTID_API=https://your-trust-id
DATAZONE_BOUND=true
DATAZONE_API_URL=https://datazone.getlifeos.app
DATAZONE_API_KEY=keyId.secret
ELFCOM_MODE=http
ELFCOM_BASE_URL=https://your-elfcom
FUNDZMAN_URL=https://your-fundzman-gateway
DISTRIBUTOR_URL=https://your-master-distribution
```

mybrandOS does not duplicate those systems. It only talks to them.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/MYBRANDOS_CREATION_ENGINE.md](docs/MYBRANDOS_CREATION_ENGINE.md).
