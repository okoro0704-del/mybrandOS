# Space Contract V1 — phase-one behavioral specification

Status: NOT VERIFIED. This specification does not authorize extraction.

Space owns a registry of independent experiences. `currentSpaceId` and
`currentExperienceId` are separate identities. SPACE is not an experience ID.
APP presentation retains product behavior; SPACE presentation follows this table.

## Presentation transitions

| Current state | Event | Next state | Effect |
| --- | --- | --- | --- |
| GLASS | DOUBLE_TAP_CANVAS | REVEAL_HANDLE | Reveal only the small overlay handle |
| REVEAL_HANDLE | TAP_HANDLE | SUMMONED_UI | Overlay controls without changing canvas |
| REVEAL_HANDLE | DOUBLE_TAP_HANDLE | REVEAL_HANDLE | Toggle handlePinned only |
| REVEAL_HANDLE | HANDLE_TIMEOUT | GLASS | Only when handlePinned is false |
| SUMMONED_UI | KEEP_UI | SUMMONED_UI | Set persistentUI, leave handlePinned unchanged |
| SUMMONED_UI | HIDE_UI | GLASS | Clear persistentUI |
| SUMMONED_UI | SELECT_EXPERIENCE | SWITCHING | Validate target in current Space; retain current experience until activation |
| SWITCHING | ACTIVATED | GLASS | Commit experience ID; preserve Space ID; restore persistent controls when requested |
| SWITCHING | ACTIVATION_FAILED | SUMMONED_UI | Preserve previous experience and expose recoverable error |
| SUMMONED_UI | OPEN_INTERACTIONS | INTERACTION | Preserve current experience and its media instance |
| INTERACTION | CLOSE_INTERACTIONS | GLASS | Return to SUMMONED_UI if persistentUI was enabled |
| SUMMONED_UI | REVOLVE | REVOLVING | Validate different Space and capture safe restoration state |
| REVOLVING | ACTIVATED | GLASS | Commit Space and restore its last valid experience/preferences |
| REVOLVING | ACTIVATION_FAILED | SUMMONED_UI | Preserve original Space and experience |

Unlisted state/event pairs are deterministic no-ops. Activation completion must
match the pending transition ID; stale completions cannot replace newer state.
Handle pinning and persistent controls are independent per-Space preferences.
GLASS suppresses full controls; a pinned handle remains available. Keyboard
reveal/summon/dismiss actions use the same transitions as pointer actions.

## Runtime and persistence invariants

- Switching never changes Space identity. Revolving changes Space identity.
- Interactions, reveal, and controls never change active experience identity.
- ACTIVE/WARM/SUSPENDED reuse each product's existing lifecycle integration.
- Background media must be silent unless an explicitly supported policy permits it.
- Keep media mounted while showing overlays; overlay geometry cannot resize canvas.
- Persist Space ID, last experience ID, handlePinned, and persistentUI in a versioned,
  tenant-scoped record. Validate restored IDs against the current registry.
- Never persist auth tokens, session credentials, or private cross-Space state.
- Cached content availability does not imply offline identity or calling support.
  Adapter capabilities must report unsupported/unavailable operations truthfully.

## Common conformance suite

Run identical behavioral cases against LifeOS and mybrandOS implementations:
all table transitions; all invalid pairs; timeout/pinning; persistent UI;
registry validation; every supported Switch pair; round-trip Revolve;
activation failure and stale completion; storage corruption/version recovery;
tenant isolation; APP presentation regression; lifecycle/media silence.

Browser evidence is mandatory for touch/double-click arbitration, keyboard access,
temporary-handle timeout, exact media element identity and bounding rectangles,
playback continuity, interactions on each experience, Switch/Revolve restoration,
refresh and offline/degraded startup. Pure tests cannot certify media stability.

No extraction or portable .space format until separately authorized. Mandatory
unproven cases keep the contract NOT VERIFIED.
