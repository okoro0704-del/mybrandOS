import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type { HomeGateway } from "@mybrandos/shared";
import { Icons } from "../nav/icons";
import { api } from "../lib/api";
import { useAppNavigate } from "../lib/paths";
import { useOs } from "../state/os-store";
import { DigiTwinPage } from "../pages/DigiTwin";
import {
  TWIN_PRESENCE_INTERVAL_MS,
  ambientReportsFromHome,
  enqueueReports,
  initialTwinAnchor,
  isMorningAt,
  isTwinPointSafe,
  morningSessionKey,
  nextTwinAnchor,
  readViewportGeometry,
  relocateAfterResume,
  reportsFromPresenceTick,
  twinAnchorPoint,
  type TwinAmbientReport,
  type TwinAnchorId,
  type TwinPresenceMode,
  type TwinViewportGeometry,
} from "./twinPresence";

const MORNING_STORAGE = "mybrandos.twin.morning";

function readCssSafe(name: "--safe-top" | "--safe-bottom" | "--safe-left" | "--safe-right"): number {
  if (typeof window === "undefined") return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function measureGeometry(modalOpen: boolean): TwinViewportGeometry {
  const dock = document.querySelector(".dock");
  const dockVisible = dock instanceof HTMLElement && getComputedStyle(dock).display !== "none";
  const rail = document.querySelector(".os > .rail");
  const railVisible = rail instanceof HTMLElement && getComputedStyle(rail).display !== "none";
  return readViewportGeometry({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    visualHeight: window.visualViewport?.height,
    visualOffsetTop: window.visualViewport?.offsetTop,
    safeTop: readCssSafe("--safe-top"),
    safeBottom: readCssSafe("--safe-bottom"),
    safeLeft: readCssSafe("--safe-left"),
    safeRight: readCssSafe("--safe-right"),
    railWidth: railVisible && rail instanceof HTMLElement ? rail.getBoundingClientRect().width : 0,
    bottomNav: dockVisible && dock instanceof HTMLElement ? dock.getBoundingClientRect().height : 0,
    modalOpen,
  });
}

function morningAlreadyShown(now: Date): boolean {
  try {
    return window.sessionStorage.getItem(MORNING_STORAGE) === morningSessionKey(now);
  } catch {
    return false;
  }
}

function markMorningShown(now: Date) {
  try {
    window.sessionStorage.setItem(MORNING_STORAGE, morningSessionKey(now));
  } catch {
    /* ephemeral if storage is blocked */
  }
}

export function DigiTwinPresence({
  intervalMs = TWIN_PRESENCE_INTERVAL_MS,
  now = () => Date.now(),
}: {
  intervalMs?: number;
  now?: () => number;
}) {
  const location = useLocation();
  const navigate = useAppNavigate();
  const { moreOpen } = useOs();
  const onTwinRoute = /\/twin\/?$/.test(location.pathname);
  const [anchor, setAnchor] = useState<TwinAnchorId>("TOP_CENTER");
  const [geo, setGeo] = useState<TwinViewportGeometry>(() =>
    readViewportGeometry({ innerWidth: 390, innerHeight: 844, railWidth: 0, bottomNav: 64 }),
  );
  const [queue, setQueue] = useState<TwinAmbientReport[]>([]);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [seedPrompt, setSeedPrompt] = useState<string | undefined>(undefined);
  const lastMovedAt = useRef(now());
  const timerRef = useRef(0);
  const reducedMotion = useRef(false);
  const reportTimer = useRef(0);

  const mode: TwinPresenceMode = onTwinRoute
    ? "CONVERSATION_ACTIVE"
    : conversationOpen
      ? "CONVERSATION_ACTIVE"
      : moreOpen || geo.modalOpen
        ? "UNAVAILABLE"
        : queue.length
          ? "HAS_REPORT"
          : "QUIET";

  const measure = useCallback(() => {
    const nextGeo = measureGeometry(moreOpen);
    setGeo(nextGeo);
    setAnchor((current) => {
      const point = twinAnchorPoint(current, nextGeo);
      if (isTwinPointSafe(point, nextGeo)) return current;
      return initialTwinAnchor(nextGeo);
    });
  }, [moreOpen]);

  useEffect(() => {
    reducedMotion.current =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setAnchor(initialTwinAnchor(measureGeometry(moreOpen)));
    measure();
    const vv = window.visualViewport;
    window.addEventListener("resize", measure);
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    return () => {
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
    };
  }, [measure, moreOpen]);

  useEffect(() => {
    const relocate = () => {
      if (document.hidden) return;
      const nextGeo = measureGeometry(moreOpen);
      setGeo(nextGeo);
      setAnchor((current) => nextTwinAnchor(current, nextGeo));
      lastMovedAt.current = now();
      void reportsFromPresenceTick();
    };
    const arm = () => {
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(relocate, intervalMs);
    };
    arm();
    const onVis = () => {
      if (document.hidden) {
        window.clearTimeout(timerRef.current);
        return;
      }
      const resume = relocateAfterResume({ lastMovedAt: lastMovedAt.current, now: now(), intervalMs });
      if (resume.relocateOnce) relocate();
      arm();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intervalMs, moreOpen, now]);

  useEffect(() => {
    if (onTwinRoute || conversationOpen) return;
    const opened = new Date(now());
    if (!isMorningAt(opened) || morningAlreadyShown(opened)) return;
    let cancelled = false;
    void api<HomeGateway>("/home")
      .then((home) => {
        if (cancelled) return;
        const incoming = ambientReportsFromHome(home);
        markMorningShown(opened);
        if (!incoming.length) return;
        setQueue((queueNow) => enqueueReports(queueNow, incoming));
      })
      .catch(() => {
        if (cancelled) return;
        markMorningShown(opened);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationOpen, now, onTwinRoute]);

  useEffect(() => {
    window.clearTimeout(reportTimer.current);
    if (!queue[0] || conversationOpen) return;
    reportTimer.current = window.setTimeout(() => {
      setQueue((items) => items.slice(1));
    }, 8000);
    return () => window.clearTimeout(reportTimer.current);
  }, [conversationOpen, queue]);

  const point = twinAnchorPoint(anchor, geo);
  const visible = !onTwinRoute && !conversationOpen && !moreOpen && !geo.modalOpen && geo.keyboardInset < 120;
  const active = queue[0];

  function openTwin(prompt?: string) {
    setSeedPrompt(prompt);
    setConversationOpen(true);
  }

  function dismissReport() {
    setQueue((items) => items.slice(1));
  }

  function onReportActivate() {
    if (!active) return;
    const href = active.href;
    dismissReport();
    if (href) {
      navigate(href);
      return;
    }
    openTwin(active.body);
  }

  return (
    <div className="twin-presence" data-twin-presence="true" data-twin-mode={mode} hidden={onTwinRoute || undefined}>
      {visible ? (
        <button
          type="button"
          className={`twin-eye${mode === "HAS_REPORT" ? " twin-eye--report" : ""}`}
          style={{
            left: point.left,
            top: point.top,
            transition: reducedMotion.current ? "none" : "left 1.1s cubic-bezier(0.22, 1, 0.36, 1), top 1.1s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
          data-twin-anchor={anchor}
          aria-label="Digi Twin"
          onClick={() => openTwin()}
        >
          <Icons.eye size={22} aria-hidden />
        </button>
      ) : null}

      {visible && active ? (
        <aside
          className="twin-report"
          data-twin-report-tone={active.tone}
          data-twin-kind={active.kind}
          data-twin-source={active.sourceSystem}
        >
          <button type="button" className="twin-report__card" onClick={onReportActivate}>
            <p className="twin-report__kicker">{active.kind === "interpretation" ? "Twin interpretation" : "Digital Life fact"}</p>
            <strong>{active.title}</strong>
            <span>{active.body}</span>
          </button>
          <button type="button" className="twin-report__dismiss" onClick={dismissReport} aria-label="Dismiss Twin report">
            Dismiss
          </button>
        </aside>
      ) : null}

      {conversationOpen && !onTwinRoute ? (
        <div className="twin-presence__conversation" role="dialog" aria-modal="true" aria-label="Digi Twin">
          <DigiTwinPage variant="presence" seedPrompt={seedPrompt} onDismiss={() => setConversationOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
