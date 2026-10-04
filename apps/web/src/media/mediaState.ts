/**
 * Smallest media lifecycle the feed needs.
 * A fetched URL is not READY: only loadeddata/canplay (a decodable current frame) is.
 * Once a frame exists, buffering, metadata repeats, chrome changes and offline blips never fall back to a blank state.
 */
export type MediaState =
  | "UNRESOLVED"
  | "RESOLVING"
  | "LOADING"
  | "READY"
  | "PLAYING"
  | "PAUSED"
  | "FAILED"
  | "OFFLINE";

export type MediaEvent =
  | { type: "SOURCE" }
  | { type: "METADATA" }
  | { type: "FRAME" }
  | { type: "PLAYING" }
  | { type: "PAUSE" }
  | { type: "ERROR"; online: boolean }
  | { type: "OFFLINE" }
  | { type: "ONLINE" }
  | { type: "RETRY" };

export function mediaHasFrame(state: MediaState): boolean {
  return state === "READY" || state === "PLAYING" || state === "PAUSED";
}

/** Poster/preview stays until the renderer has a frame to paint. */
export function mediaShowsPoster(state: MediaState): boolean {
  return !mediaHasFrame(state);
}

export function mediaIsBroken(state: MediaState): boolean {
  return state === "FAILED" || state === "OFFLINE";
}

export function initialMediaState(src: string | null | undefined): MediaState {
  return src ? "RESOLVING" : "UNRESOLVED";
}

export function reduceMediaState(state: MediaState, event: MediaEvent): MediaState {
  switch (event.type) {
    case "SOURCE":
      return state === "UNRESOLVED" ? "RESOLVING" : state;
    case "METADATA":
      return state === "RESOLVING" || state === "UNRESOLVED" ? "LOADING" : state;
    case "FRAME":
      return state === "RESOLVING" || state === "LOADING" || state === "UNRESOLVED" ? "READY" : state;
    case "PLAYING":
      return mediaIsBroken(state) ? state : "PLAYING";
    case "PAUSE":
      return state === "PLAYING" ? "PAUSED" : state;
    case "ERROR":
      return event.online ? "FAILED" : "OFFLINE";
    case "OFFLINE":
      return mediaHasFrame(state) || state === "FAILED" ? state : "OFFLINE";
    case "ONLINE":
      return state === "OFFLINE" ? "RESOLVING" : state;
    case "RETRY":
      return mediaIsBroken(state) ? "RESOLVING" : state;
    default:
      return state;
  }
}

const PRELOAD_RANK = { none: 0, metadata: 1, auto: 2 } as const;
export type MediaPreload = keyof typeof PRELOAD_RANK;

/** Preload only ever escalates for a mounted element; downgrading never discards what was already prepared. */
export function stickyPreload(previous: MediaPreload, next: MediaPreload): MediaPreload {
  return PRELOAD_RANK[next] > PRELOAD_RANK[previous] ? next : previous;
}
