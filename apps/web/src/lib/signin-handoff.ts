import type { TrustIdIdentity } from "@mybrandos/shared";
import { api, ApiError } from "./api";

/**
 * Creator sign-in from inside a host frame where Trust ID cannot run (OS Xperience App / Space:
 * no camera, no passkeys, third-party storage). Trust ID runs in the phone's browser instead and
 * the session is handed back to this frame after the creator approves a matching code there.
 */

/** OS Xperience hosts that may open the phone's browser for us. */
const OX_HOST_ORIGINS = [
  "https://xperience.getlifeos.app",
  "https://os-xperience.netlify.app",
  "https://localhost", // OS Xperience Android (Capacitor)
  "capacitor://localhost", // OS Xperience iOS (Capacitor)
];

export type HandoffStart = { handoffId: string; pollSecret: string; userCode: string; browserUrl: string; expiresAt: string };
export type HandoffPoll =
  | { status: "PENDING" | "AWAITING_APPROVAL" | "DENIED" | "EXPIRED" }
  | { status: "APPROVED"; token: string; user: TrustIdIdentity };

/** The parent page's origin when this page runs in a frame; null at top level. */
export function hostFrameOrigin(): string | null {
  try {
    if (window.top === window.self) return null;
  } catch {
    // Cross-origin parent: we are framed.
  }
  const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (ancestors && ancestors.length) return ancestors[0] ?? null;
  try {
    return document.referrer ? new URL(document.referrer).origin : "unknown";
  } catch {
    return "unknown";
  }
}

/** True when Trust ID must run outside this page (any framed context). */
export function needsSignInHandoff(): boolean {
  return hostFrameOrigin() !== null;
}

export async function startSignInHandoff(): Promise<HandoffStart> {
  return api<HandoffStart>("/auth/handoff/start", { method: "POST", body: JSON.stringify({ origin: window.location.origin }) });
}

/**
 * Ask OS Xperience to open the hand-off page in the phone's browser; fall back to a pop-up.
 * The message carries only a URL on our own origin — never a secret.
 */
export function openInBrowser(url: string): void {
  const parent = hostFrameOrigin();
  if (parent && OX_HOST_ORIGINS.includes(parent)) {
    window.parent.postMessage({ type: "ox.openExternal", version: 1, url }, parent);
    // An OS Xperience build without ox.openExternal ignores the message. Opening the device
    // browser hides this page; if it is still visible shortly after, open it ourselves.
    window.setTimeout(() => {
      if (document.visibilityState === "visible") window.open(url, "_blank", "noopener");
    }, 1200);
    return;
  }
  window.open(url, "_blank", "noopener");
}

export async function pollSignInHandoff(handoffId: string, pollSecret: string): Promise<HandoffPoll> {
  try {
    return await api<HandoffPoll>(`/auth/handoff/${encodeURIComponent(handoffId)}/poll`, {
      method: "POST",
      body: JSON.stringify({ pollSecret }),
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { status: "EXPIRED" };
    throw err;
  }
}

// ── Browser side (the page opened by OS Xperience) ──

const HANDOFF_STATE_KEY = (state: string) => `mybrandos.handoff.${state}`;

export async function beginHandoffInBrowser(handoffId: string): Promise<void> {
  const data = await api<{ url: string; state: string }>(`/auth/handoff/${encodeURIComponent(handoffId)}/authorize`, {
    method: "POST",
    body: JSON.stringify({ origin: window.location.origin }),
  });
  sessionStorage.setItem(HANDOFF_STATE_KEY(data.state), handoffId);
  window.location.href = data.url;
}

/** Whether a Trust ID callback belongs to a hand-off started in this browser tab (consumed once). */
export function takeHandoffForState(state: string): string | null {
  const key = HANDOFF_STATE_KEY(state);
  const id = sessionStorage.getItem(key);
  if (id) sessionStorage.removeItem(key);
  return id;
}

export type HandoffApproval = { id: string; userCode: string; approveSecret: string; displayName?: string };

export async function completeHandoffCallback(code: string, state: string): Promise<HandoffApproval> {
  const data = await api<{ handoff?: HandoffApproval }>("/auth/trustid/callback", {
    method: "POST",
    body: JSON.stringify({ code, state }),
  });
  if (!data.handoff) throw new Error("This sign-in is not waiting for an app.");
  return data.handoff;
}

export async function decideHandoff(approval: HandoffApproval, approve: boolean): Promise<void> {
  await api(`/auth/handoff/${encodeURIComponent(approval.id)}/decision`, {
    method: "POST",
    body: JSON.stringify({ approveSecret: approval.approveSecret, approve }),
  });
}
