# mybrandOS × LifeOS delivery — product decisions

Status: **recorded, awaiting product-owner sign-off.** These describe what the
integration branch (`integration/stage1d-lifeos-delivery`) does today. Neither is
a security gap; both are deliberate behaviour that the product owner should
confirm or change before staging.

## PD-1 — Paid posts show as teasers without a lock badge

**Current behaviour.** On a creator's public app, PREMIUM and VIP posts are listed
as teasers: title, type and date only. The public card carries `locked: true` and
`access: "PREMIUM" | "VIP"`. Text, description, cover and media are withheld
unless the viewer is entitled (covers and media are then sent
`Cache-Control: private, no-store`). The public web app does not yet read
`locked`, so a teaser appears as an ordinary post with no text and no image.

**Decision needed.**
- Keep teasers and add a lock badge / "Subscribe" affordance driven by `locked`
  (web change only; the API already exposes the flag), or
- hide paid posts from public listings entirely (one filter in the public card
  projection), or
- keep the current behaviour for this release.

**Default until decided:** teasers stay visible (titles are public, as before
this work); no paid text or media is exposed.

## PD-2 — LifeOS pull mirrors historical FREE posts for known creators

**Current behaviour.** Push delivery never sends historical posts automatically;
they go only through the operator backfill (`dist/cli/lifeos-backfill.js`, off
by default, dry run first). The LifeOS **pull** reconciler is separate and older:
for creators LifeOS already knows (catalog, installed apps,
`LIFEOS_PUBLICATION_DISCOVERY_SLUGS`, existing sources) it mirrors every post
currently on their public page that is explicitly FREE and unlocked —
including posts published before delivery existed.

**Decision needed.**
- Accept: a creator's public FREE posts are public anyway, and pull mirroring
  for known creators is existing behaviour, or
- restrict the pull to posts published after a cut-off date, or
- retire the pull for mybrandOS once push delivery is live, keeping it only as a
  removal backstop (hide posts whose public page is gone).

**Default until decided:** pull continues for known creators, FREE-only, never
overriding push events or revocations.
