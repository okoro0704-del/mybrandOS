import { useEffect, useState } from "react";
import type { PublicLiveNow } from "@mybrandos/shared";
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
): PublicLiveNow | null {
  const [liveNow, setLiveNow] = useState<PublicLiveNow | null>(initial);

  useEffect(() => {
    setLiveNow(initial);
  }, [initial]);

  useEffect(() => {
    if (!enabled || !slug) return;
    let cancelled = false;

    function tick() {
      void api<{ liveNow: PublicLiveNow | null }>(`/public/${slug}/live`)
        .then((data) => {
          if (!cancelled) setLiveNow(data.liveNow);
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
