# Recording Studio & Production Program

## Purpose

mybrandOS Recording Studio turns the workstation into a **production room**. Creators capture media with real browser/device APIs, orchestrate Device Bridge instruments, compose one **Program** from many sources, preview that Program on another device, and finalize into normal Assets.

This is an **application domain**. It does **not** add a seventh LifeOS primitive.

## Principles

> Devices are production instruments, not independent applications.

> Device delegation is session-scoped.

> A source is not a stream.

> Multiple sources can produce one Program.

> The audience receives the Program, not the raw sources.

> Audio and video are independently composable.

> Recording state is not an Asset.

> Preview is an external experience, not a Studio screenshot.

> The Shell mediates capabilities; the application executes production.

> Sovereign Drive stores the bytes.

> Platform Jobs performs long-running processing.

> The six primitives remain unchanged.

## Pipeline

```text
Physical Devices → Device Bridge → Production / Recording Session
  → Sources / Tracks / Takes / Scenes → Program
  → External Preview and/or Live
  → Sovereign Drive → Platform Jobs → Version / Asset
```

## Domain objects

| Object | Role |
|--------|------|
| `RecordingSession` | Creator workspace for a capture mode (Video, Podcast, Voice, Music, Silent, Production). Not an Asset. |
| `RecordingTrack` | Media lane (camera, vocal, beat, podcast mic, …). |
| `RecordingTake` | One recorded attempt; bytes referenced via `dataZoneId` only. |
| `ProgramOutput` | Single audience-facing composition (active video + eligible audio). |
| `PreviewSession` | Scoped, revocable external experience of the Program. |
| Production Device Bridge | Existing pairing/token model; roles assigned per session. |

## Modes

One recording engine, mode-specific track defaults:

- **VIDEO** — camera + microphone
- **PODCAST** — host/guest mics, bed, intro/outro
- **VOICE** — single voice lane
- **MUSIC** — beat + vocal takes over monitor
- **SILENT_CAPTURE** — `audioEnabled=false`; mic tracks rejected
- **PRODUCTION** — multi-camera program switching

## Program vs sources

Four cameras may participate as sources. The Program has **one** active video source at a time. Switching Camera 1 → 4 → 3 → 1 updates `ProgramOutput.activeVideoSourceId`. Audio sources are selected independently (`activeAudioSourceIds`).

Spatial / directional audio is modeled honestly:

- `directionality`: SUPPORTED | UNSUPPORTED | UNKNOWN
- `spatialPosition`: AVAILABLE | UNAVAILABLE | UNKNOWN

No fabricated localization when hardware is unbound.

## External Preview

1. Studio creates a `PreviewSession` (code + one-time token).
2. External device opens `/preview/:code?token=…`.
3. Client polls program composition; when Studio publishes program media to Sovereign Drive, preview plays the actual bytes.
4. Preview tokens cannot become owner sessions. No DataZone/FundzMan/Trust ID secrets are returned.

If a live bitstream cannot be produced (mybrandOS does not own a streaming engine), the UI reports `preview_unavailable` for the bitstream while still showing Program composition state.

## Persistence & jobs

- Bytes: Sovereign Drive / DataZone only.
- Prisma: IDs, metadata, relationships, statuses.
- Finalize may dispatch `recording.finalize` (and related job types) via Platform Jobs when bound; otherwise processing stays honestly unbound.

## Asset conversion

Finalize creates an existing Asset type (`VIDEO`, `MUSIC`, `PODCAST`, or `OTHER` for voice) with origin `CREATED_INTERNAL`. No `RecordingAsset` / `CameraAsset` types.

## mybrandOS Camera contract

`packages/shared/src/camera-hardware.ts` defines the future hardware contract. `available: false` until real hardware binds.

## Security

- Device tokens ≠ owner sessions.
- Preview tokens ≠ owner sessions.
- Pairing remains owner-Trust-ID scoped.
- No credential relay, no arbitrary project/DataZone access for devices or preview clients.

## Routes

- Workstation: `/recording`, `/recording/:id`
- Preview: `/preview/:code`
- API under `/recording/*` and `/public/preview/:code`
