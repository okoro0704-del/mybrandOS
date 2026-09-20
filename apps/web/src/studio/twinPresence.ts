/**
 * Digi Twin viewport presence — Eye movement and ambient reports.
 * Movement is UX. Observation claims require real evidence.
 * Background 10-minute Twin observation is not supported.
 */
import type { HomeGateway } from "@mybrandos/shared";

export const BACKGROUND_TWIN_OBSERVATION_SUPPORTED = false;
export const TWIN_PRESENCE_INTERVAL_MS = 10 * 60 * 1000;
export const TWIN_EYE_HIT_PX = 44;
export const TWIN_REPORT_QUEUE_MAX = 3;
export const TWIN_MORNING_START_HOUR = 5;
export const TWIN_MORNING_END_HOUR = 12;

export const QUIET_SUCCESS_COPY =
  "Successfully scanned your Digital Life. Nothing exciting to share for now.";
export const FAILED_OBSERVATION_COPY = "I couldn't complete the latest check.";
export const PARTIAL_OBSERVATION_COPY = "I could only check some of your authorized Digital Life.";

export type TwinAnchorId =
  | "TOP_CENTER"
  | "UPPER_RIGHT"
  | "MID_RIGHT"
  | "LOWER_RIGHT_SAFE"
  | "LOWER_LEFT_SAFE"
  | "MID_LEFT"
  | "UPPER_LEFT";

export const TWIN_ANCHOR_ORDER: TwinAnchorId[] = [
  "TOP_CENTER",
  "UPPER_RIGHT",
  "MID_RIGHT",
  "LOWER_RIGHT_SAFE",
  "LOWER_LEFT_SAFE",
  "MID_LEFT",
  "UPPER_LEFT",
];

export type TwinPresenceMode = "QUIET" | "OBSERVING" | "HAS_REPORT" | "CONVERSATION_ACTIVE" | "UNAVAILABLE";

export type TwinViewportGeometry = {
  width: number;
  height: number;
  safeTop: number;
  safeBottom: number;
  safeLeft: number;
  safeRight: number;
  railWidth: number;
  bottomNav: number;
  keyboardInset: number;
  modalOpen: boolean;
};

export type TwinPoint = { left: number; top: number };

export type TwinObservationStatus = "none" | "succeeded" | "failed" | "partial";

export type TwinAmbientReport = {
  id: string;
  title: string;
  body: string;
  kind: "fact" | "interpretation";
  sourceSystem: "mybrandos" | "diginews" | "digipedia" | "digi-ai";
  href?: string;
  observation: TwinObservationStatus;
  tone: "finding" | "quiet-success" | "failed" | "partial";
};

export type TwinObservationEvidence = {
  status: TwinObservationStatus;
  quiet?: boolean;
  coverage?: "complete" | "partial";
  findings?: TwinAmbientReport[];
};

const PAD = 10;

export function isMorningHour(hour: number): boolean {
  return hour >= TWIN_MORNING_START_HOUR && hour < TWIN_MORNING_END_HOUR;
}

export function isMorningAt(now: Date): boolean {
  return isMorningHour(now.getHours());
}

/** Client-local calendar day. No profile timezone database. */
export function localCalendarDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function morningSessionKey(now: Date): string {
  return `digi-twin-morning:${localCalendarDay(now)}`;
}

export function initialTwinAnchor(geo: TwinViewportGeometry): TwinAnchorId {
  return geo.railWidth > 0 ? "UPPER_RIGHT" : "TOP_CENTER";
}

export function twinAnchorPoint(id: TwinAnchorId, geo: TwinViewportGeometry): TwinPoint {
  const stageLeft = geo.railWidth;
  const stageWidth = Math.max(0, geo.width - geo.railWidth);
  const xLeft = stageLeft + geo.safeLeft + PAD;
  const xRight = geo.width - geo.safeRight - PAD - TWIN_EYE_HIT_PX;
  const xCenter = stageLeft + Math.round((stageWidth - TWIN_EYE_HIT_PX) / 2);
  const yTop = geo.safeTop + PAD;
  const yUpper = geo.safeTop + PAD + (geo.railWidth > 0 ? 8 : 0);
  const usableBottom = geo.height - geo.safeBottom - geo.bottomNav - geo.keyboardInset - PAD - TWIN_EYE_HIT_PX;
  const yLower = Math.max(yTop, usableBottom);
  const yMid = Math.round(yTop + (yLower - yTop) * 0.45);

  switch (id) {
    case "TOP_CENTER":
      return { left: xCenter, top: yTop };
    case "UPPER_RIGHT":
      return { left: xRight, top: yUpper };
    case "MID_RIGHT":
      return { left: xRight, top: yMid };
    case "LOWER_RIGHT_SAFE":
      return { left: xRight, top: yLower };
    case "LOWER_LEFT_SAFE":
      return { left: xLeft, top: yLower };
    case "MID_LEFT":
      return { left: xLeft, top: yMid };
    case "UPPER_LEFT":
      return { left: xLeft, top: yUpper };
  }
}

export function isTwinPointSafe(point: TwinPoint, geo: TwinViewportGeometry): boolean {
  if (geo.modalOpen) return false;
  if (geo.width < TWIN_EYE_HIT_PX || geo.height < TWIN_EYE_HIT_PX) return false;
  if (point.left < 0 || point.top < 0) return false;
  if (point.left + TWIN_EYE_HIT_PX > geo.width + 0.5) return false;
  if (point.top + TWIN_EYE_HIT_PX > geo.height + 0.5) return false;
  const navTop = geo.height - geo.safeBottom - geo.bottomNav;
  if (geo.bottomNav > 0 && point.top + TWIN_EYE_HIT_PX > navTop - 4) return false;
  const keyboardTop = geo.height - geo.keyboardInset;
  if (geo.keyboardInset > 0 && point.top + TWIN_EYE_HIT_PX > keyboardTop - 4) return false;
  if (point.left + TWIN_EYE_HIT_PX > stageRight(geo) + 0.5) return false;
  if (point.left < geo.railWidth - 0.5 && geo.railWidth > 0) return false;
  return true;
}

function stageRight(geo: TwinViewportGeometry): number {
  return geo.width - geo.safeRight;
}

export function safeTwinAnchors(geo: TwinViewportGeometry): TwinAnchorId[] {
  return TWIN_ANCHOR_ORDER.filter((id) => isTwinPointSafe(twinAnchorPoint(id, geo), geo));
}

export function nextTwinAnchor(current: TwinAnchorId, geo: TwinViewportGeometry): TwinAnchorId {
  const safe = safeTwinAnchors(geo);
  if (!safe.length) return initialTwinAnchor(geo);
  const from = safe.indexOf(current);
  if (from < 0) return safe[0]!;
  return safe[(from + 1) % safe.length]!;
}

export function relocateAfterResume(opts: {
  lastMovedAt: number;
  now: number;
  intervalMs?: number;
}): { relocateOnce: boolean; skippedCycles: number } {
  const interval = opts.intervalMs ?? TWIN_PRESENCE_INTERVAL_MS;
  const elapsed = opts.now - opts.lastMovedAt;
  if (elapsed < interval) return { relocateOnce: false, skippedCycles: 0 };
  return { relocateOnce: true, skippedCycles: Math.floor(elapsed / interval) };
}

export function canClaimSuccessfulScan(evidence: TwinObservationEvidence): boolean {
  return evidence.status === "succeeded" && evidence.coverage !== "partial";
}

export function reportsFromObservation(evidence: TwinObservationEvidence): TwinAmbientReport[] {
  if (evidence.status === "none") return [];
  if (evidence.status === "failed") {
    return [
      {
        id: "observation-failed",
        title: "Digi Twin",
        body: FAILED_OBSERVATION_COPY,
        kind: "fact",
        sourceSystem: "mybrandos",
        observation: "failed",
        tone: "failed",
      },
    ];
  }
  if (evidence.status === "partial" && !evidence.findings?.length) {
    return [
      {
        id: "observation-partial",
        title: "Digi Twin",
        body: PARTIAL_OBSERVATION_COPY,
        kind: "fact",
        sourceSystem: "mybrandos",
        observation: "partial",
        tone: "partial",
      },
    ];
  }
  if (evidence.findings?.length) {
    return evidence.findings.slice(0, TWIN_REPORT_QUEUE_MAX).map((item) => ({
      ...item,
      observation: evidence.status,
    }));
  }
  if (canClaimSuccessfulScan(evidence) && evidence.quiet !== false) {
    return [
      {
        id: "observation-quiet",
        title: "Digi Twin",
        body: QUIET_SUCCESS_COPY,
        kind: "fact",
        sourceSystem: "mybrandos",
        observation: "succeeded",
        tone: "quiet-success",
      },
    ];
  }
  return [];
}

export function reportsFromPresenceTick(): TwinAmbientReport[] {
  return [];
}

export type TwinAuthorizedFacts = {
  attention?: Array<{ id: string; title: string; detail: string; href: string }>;
  processing?: Array<{ id: string; title: string; status: string; detail?: string; href: string }>;
};

export function ambientReportsFromAuthorizedFacts(source: TwinAuthorizedFacts): TwinAmbientReport[] {
  const reports: TwinAmbientReport[] = [];
  for (const item of source.processing ?? []) {
    if (item.status !== "FAILED") continue;
    reports.push({
      id: `processing-${item.id}`,
      title: item.title,
      body: item.detail || "A processing job failed and needs attention.",
      kind: "fact",
      sourceSystem: "mybrandos",
      href: item.href,
      observation: "none",
      tone: "finding",
    });
  }
  for (const item of source.attention ?? []) {
    reports.push({
      id: `attention-${item.id}`,
      title: item.title,
      body: item.detail,
      kind: "fact",
      sourceSystem: "mybrandos",
      href: item.href,
      observation: "none",
      tone: "finding",
    });
  }
  return reports.slice(0, TWIN_REPORT_QUEUE_MAX);
}

export function ambientReportsFromHome(home: Pick<HomeGateway, "digitalLife" | "workstation">): TwinAmbientReport[] {
  return ambientReportsFromAuthorizedFacts({
    attention: home.digitalLife?.attention,
    processing: home.workstation?.processing,
  });
}

export function enqueueReports(queue: TwinAmbientReport[], incoming: TwinAmbientReport[]): TwinAmbientReport[] {
  const seen = new Set(queue.map((item) => item.id));
  const next = [...queue];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    next.push(item);
    seen.add(item.id);
    if (next.length >= TWIN_REPORT_QUEUE_MAX) break;
  }
  return next.slice(0, TWIN_REPORT_QUEUE_MAX);
}

export function usesSuccessfulScanLanguage(text: string): boolean {
  return /successfully scanned/i.test(text);
}

export function readViewportGeometry(input?: {
  innerWidth?: number;
  innerHeight?: number;
  visualHeight?: number;
  visualOffsetTop?: number;
  safeTop?: number;
  safeBottom?: number;
  safeLeft?: number;
  safeRight?: number;
  railWidth?: number;
  bottomNav?: number;
  modalOpen?: boolean;
}): TwinViewportGeometry {
  const width = input?.innerWidth ?? (typeof window !== "undefined" ? window.innerWidth : 390);
  const height = input?.innerHeight ?? (typeof window !== "undefined" ? window.innerHeight : 844);
  const visualHeight = input?.visualHeight ?? (typeof window !== "undefined" ? window.visualViewport?.height : undefined);
  const visualOffset = input?.visualOffsetTop ?? (typeof window !== "undefined" ? window.visualViewport?.offsetTop : 0);
  const keyboardInset =
    visualHeight != null ? Math.max(0, height - visualHeight - (visualOffset ?? 0)) : 0;
  const mobile = width <= 980;
  return {
    width,
    height,
    safeTop: input?.safeTop ?? 0,
    safeBottom: input?.safeBottom ?? 0,
    safeLeft: input?.safeLeft ?? 0,
    safeRight: input?.safeRight ?? 0,
    railWidth: input?.railWidth ?? (mobile ? 0 : 268),
    bottomNav: input?.bottomNav ?? (mobile ? 64 : 0),
    keyboardInset,
    modalOpen: Boolean(input?.modalOpen),
  };
}
