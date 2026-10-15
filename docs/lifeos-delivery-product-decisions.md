# mybrandOS × LifeOS delivery — product decisions

Status: **approved by the product owner on 2026-10-15.** Both decisions describe
deliberate behaviour of the integration branch (`integration/stage1d-lifeos-delivery`)
and its successors. Neither is a security gap.

## PD-1 — Paid posts show as secure teasers (APPROVED, with a launch condition)

**Decision.** Paid teasers remain, temporarily. **A visible lock indicator is required
before public launch.**

**Current behaviour.** On a creator's public app, PREMIUM and VIP posts are listed
as teasers: title, type and date only. The public card carries `locked: true` and
`access: "PREMIUM" | "VIP"`. Text, description, cover and media are withheld
unless the viewer is entitled; entitled covers and media are sent
`Cache-Control: private, no-store`. The public web app does not yet read `locked`,
so a teaser currently appears as a post with no text and no image.

**Launch condition.** Before public launch, the public web app must render a
visible lock indicator (badge and/or "Subscribe" affordance) driven by `locked`.
The API already exposes the flag; this is a web change.

## PD-2 — Historical FREE synchronization stays enabled (APPROVED)

**Decision.** Historical FREE synchronization remains enabled under the existing
ownership, authorization, revocation and replay protections.

**Current behaviour.** Push delivery never sends historical posts automatically;
they go only through the operator backfill (`dist/cli/lifeos-backfill.js`, off by
default, dry run first). The LifeOS pull reconciler mirrors, for creators LifeOS
already knows (catalog, installed apps, `LIFEOS_PUBLICATION_DISCOVERY_SLUGS`,
existing sources), every post currently on their public page that is explicitly
FREE and unlocked, including posts published before push delivery existed.

**Protections this decision relies on (must stay in place):**
- Only explicit, unlocked FREE cards are ingested; missing or ambiguous
  classification fails closed.
- Ownership: a publication bound to one origin creator cannot be claimed by
  another (409); mybrandOS sources use one canonical application id.
- Authorization: ingest and reconcile accept only the dedicated
  `LIFEOS_PUBLICATION_INGEST_SECRET`.
- Revocation and replay: pushed (sequenced) publications are authoritative; pull
  never modifies or resurrects them, and older sequences are acknowledged as stale.
- A creator space that is disabled, suspended or removed (origin 404/410) takes its
  pulled posts down.
