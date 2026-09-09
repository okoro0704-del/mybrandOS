# mybrandOS — Six Primitive & Platform Job Compliance Audit

BUILD PROMPT 006. Audit only. No Video Studio. No seventh primitive. No new queues, storage, identity, messaging, or ledger.

**Verdict: PARTIAL**

Domain studios (Creation Engine, Book, Course, Asset Intelligence) consume application state correctly. Primitive wiring is incomplete.

---

## 1. Executive summary

Applications must consume the six Phase F primitives. mybrandOS already does this *in shape* (adapters + unbound honesty) for Trust ID, DataZone, ElfCom, FundzMan, and a distribution adapter. It does **not** consume Platform Jobs. Default local mode stores file bytes in process memory. Several remote paths do not match the live engines.

DIGICONOMY is the intended thin shell and has not integrated the six SDKs yet. LIFEOS owns the canonical registry. LIFEOS PORTAL is the control plane. OS shells own vertical domain data.

## 2. Canonical six primitives

Authoritative IDs in `LifeOS/packages/shared/src/primitives/index.ts` (`LIFEOS_PRIMITIVE_IDS`):

| # | ID | Engine | Responsibility | Actual code |
| - | -- | ------ | -------------- | ----------- |
| 1 | `trust-id` | Trust ID | Identity & biometrics | `TRUST ID` |
| 2 | `elfcom` | ElfCom | Messaging & realtime | `ELFCOMS` |
| 3 | `sovereign-drive` | Sovereign Drive | Storage & KMS; DataZone BaaS belongs here | `DATA INFRASTRUCTURE` |
| 4 | `platform-jobs` | Platform Jobs | Background processing & queues | `Platform Job` |
| 5 | `master-distributor` | Master Distributor | Infra, provisioning, OS artifact releases | `Master Distribution` |
| 6 | `fundzman` | FundzMan | Pass-through wallet, billing, escrow | Intended API **NOT ESTABLISHED** in the Desktop FUNDZMAN product repo |

Do not treat AI, analytics, audience, or search as primitives.

## 3. Platform Job definition

`platform-jobs-engine`: Redis/BullMQ queue `platform-jobs`, `POST /v1/jobs/dispatch`, status, cancel, retries, `deduplicationKey`, delay/`scheduledAt`. Cron exists in-library, not as HTTP. Worker is a separate process; default handler is a no-op.

`@lifeos/distribution-hub` is a **producer gateway beside Platform Jobs** (jobs API + ElfCom push). It is **not** Master Distributor and **not** a seventh primitive.

## 4–5. Responsibility and system-of-record matrices

See the live canvas beside this chat, and the tables in this document below.

| Domain | System of record | Notes |
| ------ | ---------------- | ----- |
| Identity / biometrics / auth | Trust ID | mybrandOS Session is a cache after Trust ID proof |
| File bytes / KMS | Sovereign Drive / DataZone | mybrandOS stores `dataZoneId` |
| Messaging / realtime / notifications | ElfCom | Activity is not mail |
| Jobs / queues | Platform Jobs | mybrandOS unused |
| Deploy / domains / OS releases | Master Distributor | Not content publish |
| Wallet / billing / escrow | FundzMan (intended) | Product repo is not the primitive |
| Assets / projects / content / versions | mybrandOS | Correct |
| Audience / analytics | **NOT ESTABLISHED** | Hooks + placeholders only |
| Search | mybrandOS metadata (interim) | SQL, not a search engine |
| AI execution | Configured provider | Not a primitive |

## 6. mybrandOS backend audit (A–G)

- **A (domain):** Asset, Session, Activity, CreationProject, ContentBlock, ProjectVersion, AiAction, AssetRelationship, ProjectMember, PersonalSpace, Book*, Course*, CommerceItem (offer hook), Asset Intelligence, metadata search.
- **B (consume primitive):** ProjectFile bytes → DataZone/Sovereign Drive; identity → Trust ID; inbox/notify → ElfCom; wallet display → FundzMan.
- **C (Platform Jobs):** ImportJob is a completed sync row today. Large import, media, and long AI should dispatch jobs.
- **D (Master Distributor):** DistributionIntent is a valid app intent. Posting content to `/v1/releases` is the wrong API.
- **E:** Portal Finprove is a billing facade, not a primitive.
- **F:** In-memory LocalDataZone blobs; fabricated LocalElfCom inbox.
- **G:** FundzMan product vs primitive API; `primitiveId: "ai"` naming; DataZone vs `sovereign-drive` ID; `distribution` vs `master-distributor` ID.

## 7–10. Creation Engine / Book / Course / Intelligence

All four are **application-domain** layers. They must stay in mybrandOS. Course Studio did not recreate primitive infrastructure. Asset Intelligence must not become a seventh primitive.

## 11–17. Storage, auth, messaging, finance, jobs, distribution, AI

- Storage: remote DataZone BaaS is correct; local Map is DEVELOPMENT ONLY.
- Auth: OAuth/PKCE production path exists; `/auth/dev-session` is blocked when Trust ID is bound outside development.
- Messaging: no second engine; adapter path mismatch (`/v1/inbox` vs `/v1/threads/:userId`).
- Finance: no ledger; revenue stays null without allocation data.
- Jobs: none in mybrandOS (good). Missing consumer (gap).
- Distribution: Personal Space ≠ Master Distributor ≠ Platform Jobs hub.
- AI: provider + `AiAction` history. Long work → Platform Jobs.

## 18–20. Analytics, audience, search

Analytics and audience SoR: **NOT ESTABLISHED**. Search: application metadata is sufficient.

## 21. Cross-primitive workflows

Create/import: mybrandOS orchestrates; Trust ID auth; DataZone bytes; optional platform-jobs parse.

Publish to Personal Space: mybrandOS only.

External fan-out: intent in mybrandOS → platform-jobs → destinations; ElfCom notify; Master Distributor only for OS/domain provision.

Monetize: CommerceItem hook → FundzMan settlement (when API exists).

## 22–25. Adapters, security, failure, cache

Adapters exist but omit platform-jobs, retries, and honest remote failure (FundzMan/ElfCom/Distribution swallow errors). Frontend never holds primitive secrets. Production must not fall back to local identity or local blobs. Cache UI/metadata only — never wallet, authz, or private bytes.

## 26. Refactoring (do not execute in this phase)

| Pri | Change |
| --- | ------ |
| P0 | Production refuses `PRIMITIVES_MODE=local` storage/identity |
| P0 | Unbound ElfCom returns empty inbox, not a fake message |
| P0 | FundzMan errors are not converted into bound zeros |
| P1 | Add Platform Jobs adapter (`POST /v1/jobs/dispatch`) |
| P1 | Canonical IDs: `sovereign-drive`, `master-distributor` |
| P1 | Stop posting content assets to Master Distributor `/v1/releases` |
| P1 | Align ElfCom inbox route |
| P2 | Do not treat Desktop FUNDZMAN product as the primitive; MD should dispatch platform-jobs for release pipeline |

## 27–28. Target architecture and golden rules

DIGICONOMY / LIFEOS / OS shells → application APIs → adapters → Platform Jobs (async) and six engines.

Rules: six IDs only; apps consume; domain models allowed; Platform Jobs owns queues; Sovereign Drive owns bytes; Trust ID owns identity; ElfCom owns messaging; Master Distributor owns provisioning/OS artifacts; FundzMan owns money; failures are honest; AI is not a primitive; `distribution-hub` ≠ Master Distribution.

## 29. PASS / PARTIAL / FAIL

**PARTIAL.**

Must change before claiming BaaS compliance: production-closed local adapters, Platform Jobs consumption for async work, adapter contract alignment, distribution API ownership.

Studio *domain* architecture already passes.

## 30. Exact next action

Do **not** start Video Studio, Music Studio, or Software Studio.

Next build prompt: **primitive consumption alignment** (adapters + failure honesty + ID aliases). After that, Video Studio may proceed as another Creation Engine specialization.
