import { useEffect, useRef, useState } from "react";
import type { PublicLiveNow, PublicStationResume } from "@mybrandos/shared";
import { api } from "../../lib/api";

/** Public live presence poll — no fake broadcasts. Relies on GET /public/:slug/live. */
export const PUBLIC_LIVE_POLL_MS = 12_000;

export function isBrandLive(liveNow: PublicLiveNow | null | undefined): boolean {
  return Boolean(liveNow?.sessionId && liveNow.startedAt);
}

export function usePublicLiveNow(
  slug: string | undefined,
  initial: PublicLiveNow | null,
  enabled = true,
  onStationResume?: (resume: PublicStationResume[]) => void,
): PublicLiveNow | null {
  const [liveNow, setLiveNow] = useState<PublicLiveNow | null>(initial);
  const resumeRef = useRef(onStationResume);
  resumeRef.current = onStationResume;
  const resumeKey = useRef("");

  useEffect(() => {
    setLiveNow(initial);
  }, [initial]);

  useEffect(() => {
    if (!enabled || !slug) return;
    let cancelled = false;

    function tick() {
      void api<{ liveNow: PublicLiveNow | null; stationResume?: PublicStationResume[] }>(`/public/${slug}/live`)
        .then((data) => {
          if (cancelled) return;
          setLiveNow((current) =>
            current?.sessionId === data.liveNow?.sessionId && current?.kind === data.liveNow?.kind ? current : data.liveNow,
          );
          const key = JSON.stringify(data.stationResume ?? []);
          if (key !== resumeKey.current) {
            resumeKey.current = key;
            resumeRef.current?.(data.stationResume ?? []);
          }
        })
        .catch(() => {
          /* keep last known honest state */
        });
    }

    tick();
    const id = window.setInterval(tick, PUBLIC_LIVE_POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [slug, enabled]);

  return liveNow;
}
