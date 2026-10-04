/**
 * Opt-in acceptance instrumentation (`localStorage["mybrandos:media-metrics"] = "1"`).
 * Silent and allocation-free unless enabled; never logs to the console.
 */
export type MediaMetricEvent = "mount" | "unmount" | "metadata" | "frame" | "canplay" | "playing" | "error" | "retry";

export type MediaMetricRecord = {
  src: string;
  mounts: number;
  events: Array<{ event: MediaMetricEvent; at: number; sinceMount: number }>;
};

type MetricsStore = Record<string, MediaMetricRecord>;

declare global {
  interface Window {
    __mybrandosMediaMetrics?: MetricsStore;
  }
}

let enabledCache: boolean | null = null;

export function mediaMetricsEnabled(): boolean {
  if (enabledCache !== null) return enabledCache;
  try {
    enabledCache = typeof window !== "undefined" && window.localStorage.getItem("mybrandos:media-metrics") === "1";
  } catch {
    enabledCache = false;
  }
  return enabledCache;
}

const mountedAt = new Map<string, number>();

export function recordMediaMetric(src: string, event: MediaMetricEvent): void {
  if (!src || !mediaMetricsEnabled()) return;
  const now = performance.now();
  const store = (window.__mybrandosMediaMetrics ??= {});
  const record = (store[src] ??= { src, mounts: 0, events: [] });
  if (event === "mount") {
    record.mounts += 1;
    mountedAt.set(src, now);
  }
  record.events.push({ event, at: Math.round(now), sinceMount: Math.round(now - (mountedAt.get(src) ?? now)) });
}
