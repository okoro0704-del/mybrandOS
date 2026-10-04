import { useCallback, useEffect, useRef, useState } from "react";
import {
  LIVE_HEARTBEAT_INTERVAL_MS,
  goLiveReadiness,
  type GoLiveReadiness,
  type LiveCapability,
  type LiveSessionKind,
  type StationResumePolicy,
  type UnifiedLiveSession,
  type VisibilityMode,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";

type Overview = { capability: LiveCapability; active: UnifiedLiveSession | null; sessions: UnifiedLiveSession[] };
type View = { live: UnifiedLiveSession; session: { detail: string } };

export type GoLiveInput = {
  title: string;
  description: string;
  visibility: VisibilityMode;
  resumePolicy?: StationResumePolicy;
  sourceAssetId?: string;
};

/**
 * One Go Live controller for VIDEO, TV and RADIO over the canonical LiveSession.
 * LIVE is shown only when the server reports provider-confirmed LIVE.
 */
export function useProductionLive(kind: LiveSessionKind) {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [routeReachable, setRouteReachable] = useState(false);
  const [session, setSession] = useState<UnifiedLiveSession | null>(null);
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [connection, setConnection] = useState<"CONNECTED" | "RECONNECTING">("CONNECTED");
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<UnifiedLiveSession | null>(null);
  sessionRef.current = session;

  const refresh = useCallback(async () => {
    try {
      const data = await api<Overview>("/production/live");
      setOverview(data);
      setRouteReachable(true);
      const mine = data.active && data.active.type === kind ? data.active : null;
      if (mine) setSession(mine);
      return data;
    } catch {
      setRouteReachable(false);
      return null;
    }
  }, [kind]);

  useEffect(() => {
    void refresh();
    const onStatus = () => {
      setOnline(navigator.onLine);
      void refresh();
    };
    window.addEventListener("online", onStatus);
    window.addEventListener("offline", onStatus);
    return () => {
      window.removeEventListener("online", onStatus);
      window.removeEventListener("offline", onStatus);
    };
  }, [refresh]);

  const readiness: GoLiveReadiness = goLiveReadiness({
    online,
    routeReachable,
    providerAvailable: Boolean(overview?.capability.available),
  });
  const otherActive = overview?.active && overview.active.type !== kind ? overview.active : null;

  // Heartbeat keeps a confirmed broadcast alive; missed beats lead to safe server-side recovery.
  useEffect(() => {
    if (session?.status !== "LIVE") return;
    const id = session.id;
    const beat = async () => {
      try {
        const view = await api<View>(`/production/live/${id}/heartbeat`, {
          method: "POST",
          body: JSON.stringify({ connection: "CONNECTED" }),
        });
        setConnection("CONNECTED");
        setSession(view.live);
      } catch (err) {
        if (err instanceof ApiError && err.code === "live_not_active") {
          setDetail("The live session ended. Scheduled programming continues.");
          await refresh();
          setSession(null);
          return;
        }
        setConnection("RECONNECTING");
      }
    };
    const timer = window.setInterval(() => void beat(), LIVE_HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [session?.id, session?.status, refresh]);

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { code: err.code, message: err.message }
          : { code: "network", message: "The request did not reach mybrandOS." },
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  const prepare = (input: GoLiveInput) =>
    run(async () => {
      const view = await api<View>("/production/live", {
        method: "POST",
        body: JSON.stringify({ kind, ...input, source: input.sourceAssetId ? "asset" : "camera" }),
      });
      setSession(view.live);
      setDetail(view.session.detail);
      return view.live;
    });

  const start = (input: GoLiveInput) =>
    run(async () => {
      if (readiness.status === "ROUTE_REQUIRED") {
        throw new ApiError(0, "route_required", readiness.detail);
      }
      let current = sessionRef.current;
      if (!current || (current.status !== "PREPARING" && current.status !== "FAILED")) {
        const view = await api<View>("/production/live", {
          method: "POST",
          body: JSON.stringify({ kind, ...input, source: input.sourceAssetId ? "asset" : "camera" }),
        });
        current = view.live;
      }
      setSession({ ...current, status: "STARTING" });
      setDetail("Starting. Waiting for the live provider to confirm.");
      try {
        const view = await api<View>(`/production/live/${current.id}/start`, { method: "POST", body: "{}" });
        setSession(view.live);
        setDetail(view.session.detail);
        await refresh();
        return view.live;
      } catch (err) {
        setSession({ ...current, status: "FAILED" });
        setDetail(err instanceof ApiError ? err.message : "Live could not start.");
        await refresh();
        throw err;
      }
    });

  const end = () =>
    run(async () => {
      const current = sessionRef.current;
      if (!current) return null;
      setSession({ ...current, status: "ENDING" });
      const view = await api<View>(`/production/live/${current.id}/end`, { method: "POST", body: "{}" });
      setSession(view.live);
      setDetail(view.session.detail);
      await refresh();
      return view.live;
    });

  const reset = () => {
    setSession(null);
    setDetail("");
    setError(null);
  };

  return {
    overview,
    readiness,
    session,
    detail,
    error,
    connection,
    busy,
    otherActive,
    refresh,
    prepare,
    start,
    end,
    reset,
  };
}
