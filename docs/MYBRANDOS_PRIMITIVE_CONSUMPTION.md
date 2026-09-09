# mybrandOS primitive consumption

mybrandOS is an application/domain shell. It consumes the canonical six LifeOS primitives as backend services. It does not own identity, blob storage, messaging transport, queues, OS deployment, or wallets.

Source of truth for primitive IDs: LifeOS `packages/shared/src/primitives/index.ts`, mirrored in `@mybrandos/shared` as `LIFEOS_PRIMITIVE_IDS`.

## 1. Canonical six primitive registry

| ID | Engine | mybrandOS role |
| --- | --- | --- |
| `trust-id` | Trust ID Engine | Identity authority (OAuth/PKCE) |
| `elfcom` | ElfCom Engine | Messaging / notify |
| `sovereign-drive` | Sovereign Drive / DataZone | Object storage (BaaS upload-intent + bytes) |
| `platform-jobs` | Platform Jobs Engine | Asynchronous work |
| `master-distributor` | Master Distributor Engine | OS/application releases, domains, SSL |
| `fundzman` | FundzMan Engine | Wallet, billing, settlement |

Aliases (never independent primitives):

```
identity     → trust-id
messaging    → elfcom
storage      → sovereign-drive
datazone     → sovereign-drive
jobs         → platform-jobs
billing      → fundzman
wallet       → fundzman
```

`distribution-hub` is **not** `master-distributor`. AI is a **provider** (`IAiProvider`), not a seventh primitive.

## 2. Adapter map

| Primitive | Production adapter | Development adapter |
| --- | --- | --- |
| `trust-id` | `RemoteTrustIdAdapter` | `LocalTrustIdAdapter` (throws if `NODE_ENV=production`) |
| `elfcom` | `RemoteElfComAdapter` (`ELFCOM_MODE=http`) | `LocalElfComAdapter` (empty inbox, notify throws) |
| `sovereign-drive` | `RemoteDataZoneAdapter` (`DATAZONE_BOUND=true`) | `LocalDataZoneAdapter` (in-memory Map, production-forbidden) |
| `platform-jobs` | `RemotePlatformJobsAdapter` | `UnboundPlatformJobsAdapter` (throws, no local queue) |
| `master-distributor` | `RemoteMasterDistributorAdapter` when URL set | `LocalMasterDistributorAdapter` (optional unbound) |
| `fundzman` | `RemoteFundzManAdapter` when primitive URL set | `LocalFundzManAdapter` (`connected: false`, balances `null`) |

Application-level (not primitives):

- `ApplicationDistributionAdapter` / `LocalDistributionAdapter` — content `DistributionIntent` + Personal Space
- `IAiProvider` — OpenAI / test / unbound

Registry: `packages/integrations/src/container.ts` (`createPrimitiveContainer`).

## 3. Endpoint contracts actually consumed

| Primitive | Method | Path | Notes |
| --- | --- | --- | --- |
| Trust ID | GET | `/oauth/authorize` | PKCE start |
| Trust ID | POST | `/oauth/token` | code exchange |
| Trust ID | GET | `/oauth/userinfo` | identity proof |
| Trust ID | POST | `/auth/session` | session resolve |
| ElfCom | GET | `/v1/threads/:userId` | inbox (JWT `sub` / owner id) |
| ElfCom | POST | `/v1/notify` | outbound notify |
| Sovereign Drive / DataZone | POST | `/v1/baas/assets/upload-intent` | DataZone `:4200` BaaS |
| Sovereign Drive / DataZone | POST | upload URL from intent | bytes persist remotely |
| Sovereign Drive / DataZone | GET | `/v1/datazone/assets/:id` | metadata |
| Sovereign Drive / DataZone | GET | `/v1/datazone/assets/:id/bytes` | bytes |
| Platform Jobs | POST | `/v1/jobs/dispatch` | `{ jobName, payload, delayMs?, deduplicationKey? }` |
| Platform Jobs | GET | `/v1/jobs/:jobId/status` | status |
| Platform Jobs | POST | `/v1/jobs/:jobId/cancel` | cancel (adapter status path used) |
| Master Distributor | POST | `/v1/deployments` | OS/application deploy only |
| FundzMan | GET | `/v1/wallet/:userId/summary` | primitive API, not the Supabase product |

mybrandOS application APIs the browser may call:

- `POST /jobs/dispatch`, `GET /jobs/:jobId` — wraps Platform Jobs; secrets stay server-side
- `GET /elfcom/inbox` — wraps ElfCom; empty + `unavailable` if unbound
- `GET /system/primitives` — six-id health reports
- `POST /auth/dev-session` — development + `PRIMITIVES_MODE=local` only

## 4. Production vs development behavior

**Development** (`NODE_ENV!==production`, typically `PRIMITIVES_MODE=local`):

- Local Trust ID session `TD-LOCAL-MYBRANDOS` allowed via `/auth/dev-session`
- In-memory DataZone permitted; bytes are not durable
- Unbound Platform Jobs / ElfCom / FundzMan / Master Distributor are honest (throw or `connected: false`)

**Production** (`NODE_ENV=production`):

- `PRIMITIVES_MODE=remote` required
- Trust ID API required; local identity constructor throws
- DataZone must be bound (`DATAZONE_BOUND` + key + URL)
- `PLATFORM_JOBS_URL` required — no local Redis/BullMQ/worker
- ElfCom, FundzMan, Master Distributor may be **optional + unbound** and must be reported that way
- Startup fails closed via `assertProductionPrimitiveConfig`

A URL in `.env` is not health. Health calls `/health` (or equivalent) on the bound adapter.

## 5. Failure semantics

Every primitive call maps to:

`SUCCESS` · `UNAVAILABLE` · `UNAUTHORIZED` · `TIMEOUT` · `INVALID_REQUEST` · `UPSTREAM_ERROR` · `NOT_CONFIGURED`

Named codes:

- `TRUST_ID_UNAVAILABLE`
- `ELFCOM_UNAVAILABLE`
- `DATAZONE_UNAVAILABLE`
- `PLATFORM_JOBS_UNAVAILABLE`
- `MASTER_DISTRIBUTOR_UNAVAILABLE`
- `FUNDZMAN_UNAVAILABLE`

Never convert infrastructure failure into successful-looking domain data:

| Failure | Not allowed |
| --- | --- |
| DataZone down | `file saved = true` |
| ElfCom down | fabricated inbox / `message sent = true` |
| Platform Jobs down | `job queued = true` without a job id |
| FundzMan down | `balance = 0`, `revenue = 0`, `connected: true` |
| Master Distributor down | `deployment successful` |

`ImportJob` statuses: `REQUESTED` → `QUEUED` (only with a Platform Jobs `jobId`) → `PROCESSING` → `COMPLETED` / `FAILED` / `CANCELLED`.

## 6. Health model

`collectPrimitiveHealth` returns, for each canonical id:

```ts
{ id, bound, healthy, capabilities, lastChecked, failureReason, label, ok, detail }
```

- `bound` means a remote adapter was constructed
- `healthy` means the live health check succeeded
- Unbound optional primitives: `bound: false`, `healthy: false`, `failureReason: NOT_CONFIGURED`

AI health is reported separately under `/health.primitives.ai` and is **not** in the six-id registry.

## 7. Data ownership matrix

**mybrandOS owns (domain):** Asset, CreationProject, ContentBlock, ProjectVersion, ProjectFile (DataZone reference), Book/Course models, AssetRelationship, PersonalSpace, DistributionIntent, CommerceItem (offer definition, not a wallet), Activity, ImportJob (application record, not a queue).

**Primitives own (infrastructure):**

| Concern | Owner |
| --- | --- |
| Identity / biometrics | `trust-id` |
| Chat transport, push, delivery | `elfcom` |
| Object/blob bytes | `sovereign-drive` |
| Queues, workers, retries, schedules | `platform-jobs` |
| OS deploy, domains, SSL, app provisioning | `master-distributor` |
| Money movement, wallet, escrow, settlement | `fundzman` |

Personal Space is a user-facing mybrandOS surface. Publishing an Asset there is an application operation.

## 8. Asynchronous job architecture

```
Creator action
  → mybrandOS API (auth via Trust ID session)
  → DataZone persist (if bytes)
  → Platform Jobs POST /v1/jobs/dispatch
  → worker (owned by Platform Jobs)
  → DataZone output
  → mybrandOS domain state (ImportJob / DistributionIntent / AiAction)
```

Studio job types (`STUDIO_JOB_TYPES`): `import.manuscript`, `import.course`, `import.media`, `import.bulk`, `ai.invoke`, `media.transcode`, `media.video`, `media.audio`, `distribution.fan-out`, `asset.bulk`, `transform.long`.

Small synchronous imports may complete in-process after DataZone store. Large imports (`LARGE_IMPORT_BYTES`, default 8MiB, or many files) persist to DataZone then dispatch; they never claim `QUEUED` without a job id.

Content fan-out:

```
Asset → Personal Space (app)
     → DistributionIntent
     → Platform Jobs distribution.fan-out
     → distribution adapter
```

OS branded application:

```
mybrandOS release artifact → Master Distributor /v1/deployments
```

Books and courses are **never** posted to `/v1/releases`.

Video Studio is **not** started. When it is, it should consume the same six adapters (ProjectFile → DataZone, processing → Platform Jobs).

## 9. Security boundary

```
Browser
  → mybrandOS application APIs
  → server-side adapters
  → six canonical engines
```

The browser must never receive DataZone keys, ElfCom node secrets, Platform Jobs tokens, FundzMan private credentials, Master Distributor admin credentials, or AI provider keys.

## 10. Remaining unbound primitives

Typical local/dev deployment after this work:

| Primitive | Typical local state | Blocker if unbound in a remote deploy |
| --- | --- | --- |
| `trust-id` | Unbound local adapter | Production requires `TRUSTID_API` + OAuth |
| `elfcom` | Unbound | Set `ELFCOM_MODE=http` + live ElfCom node |
| `sovereign-drive` | Unbound in-memory | Production requires DataZone BaaS bind |
| `platform-jobs` | Unbound (throws on dispatch) | Production requires `PLATFORM_JOBS_URL` pointing at Desktop/Platform Job |
| `master-distributor` | Optional unbound | Set `MASTER_DISTRIBUTOR_URL` only for OS releases |
| `fundzman` | Optional unbound | Canonical primitive `GET /v1/wallet/:userId/summary` is not the FundzMan Supabase product. Until that API is bound, values stay `null` / `connected: false` |

Do not substitute missing primitive APIs with production mocks.

## 11. Integration test evidence

Run from repo root:

```
npm test
npm run typecheck
```

Suites:

- `apps/api/test/creation-engine.test.ts` — Creation Engine domain
- `apps/api/test/book-studio.test.ts` — Book Studio
- `apps/api/test/course-studio.test.ts` — Course Studio
- `apps/api/test/asset-intelligence.test.ts` — Asset Intelligence
- `apps/api/test/primitives.test.ts` — six-primitive contracts (Trust ID production rejection, ElfCom no fakes, DataZone no production local store, Platform Jobs dispatch + no local queue, Master Distributor vs distribution-hub, FundzMan no fake balances / no Supabase URL)
- `apps/api/test/architecture-guard.test.ts` — fails if BullMQ, Redis clients, S3/MinIO blob engines, WebSocket servers, biometric IdP, or local wallet ledgers appear in `apps/api/src` or `packages/integrations/src`

`ImportJob` and `ProjectFile` remain permitted domain models. `BullMQ Worker` and an S3-compatible blob engine inside mybrandOS are not.
