import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

const CHANNEL = "os-shell";
const VERSION = "0.7";
const TRUSTED_SHELL_ORIGINS = ["http://127.0.0.1:5180", "http://localhost:5180"] as const;

export type ShellPolicyResult = {
  capability: string;
  status: string;
  reason?: string;
  detail?: string;
};

type OsShellApi = {
  connected: boolean;
  shellOrigin: string | null;
  requestShellCapability: (capability: string) => Promise<ShellPolicyResult>;
  getShellCapabilityStatus: (capability: string) => Promise<ShellPolicyResult>;
  reportShellExecution: (capability: string, started: boolean, result: string) => void;
};

const disconnected: OsShellApi = {
  connected: false,
  shellOrigin: null,
  requestShellCapability: async (capability) => ({
    capability,
    status: "denied",
    reason: "NOT_CONNECTED",
    detail: "Not hosted in OS Shell.",
  }),
  getShellCapabilityStatus: async (capability) => ({
    capability,
    status: "denied",
    reason: "NOT_CONNECTED",
    detail: "Not hosted in OS Shell.",
  }),
  reportShellExecution: () => undefined,
};

const OsShellContext = createContext<OsShellApi>(disconnected);

function isTrustedShell(origin: string): boolean {
  return (TRUSTED_SHELL_ORIGINS as readonly string[]).includes(origin);
}

function detectShellOrigin(): string | null {
  const ancestors = window.location.ancestorOrigins;
  const ancestor = ancestors && ancestors.length > 0 ? ancestors[0] : null;
  if (ancestor && isTrustedShell(ancestor)) return ancestor;
  if (document.referrer) {
    try {
      const origin = new URL(document.referrer).origin;
      if (isTrustedShell(origin)) return origin;
    } catch {
      return null;
    }
  }
  return null;
}

function canGoBack(): boolean {
  return window.history.length > 1;
}

function outcomeOf(data: { outcome?: ShellPolicyResult; capability?: string }): ShellPolicyResult {
  if (data.outcome && typeof data.outcome === "object") return data.outcome;
  return { capability: data.capability ?? "unknown", status: "denied", reason: "malformed_result" };
}

export function useOsShell(): OsShellApi {
  return useContext(OsShellContext);
}

/**
 * Thin OS Shell participant. Copies the os-shell postMessage contract.
 * Does not import @osshell/*, own Trust ID, or move Production / Device Bridge / Live into the Shell.
 * Does not request camera (or any capability) automatically on launch.
 */
export function OsShellParticipant(props: { name: string; children?: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [shellOrigin, setShellOrigin] = useState<string | null>(null);
  const originRef = useRef<string | null>(null);
  const pendingRef = useRef(new Map<string, (result: ShellPolicyResult) => void>());
  const seq = useRef(0);

  useEffect(() => {
    if (window.parent === window) return;
    const origin = detectShellOrigin();
    if (!origin) return;
    originRef.current = origin;
    setShellOrigin(origin);

    function onMessage(event: MessageEvent) {
      if (event.origin !== origin) return;
      const data = event.data as {
        channel?: string;
        version?: string;
        type?: string;
        requestId?: string;
        outcome?: ShellPolicyResult;
        capability?: string;
      } | null;
      if (!data || data.channel !== CHANNEL || data.version !== VERSION) return;
      if (data.type === "application.back" && canGoBack()) navigate(-1);
      if (
        (data.type === "capability.result" ||
          data.type === "permission.result" ||
          data.type === "capability.status.result") &&
        data.requestId
      ) {
        const resolve = pendingRef.current.get(data.requestId);
        if (!resolve) return;
        pendingRef.current.delete(data.requestId);
        resolve(outcomeOf(data));
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate]);

  useEffect(() => {
    const targetOrigin = originRef.current;
    if (typeof targetOrigin !== "string") return;
    const path = `${location.pathname}${location.search}`;
    const payload = (type: string, extra: Record<string, unknown> = {}) =>
      ({ channel: CHANNEL, version: VERSION, type, ...extra });
    window.parent.postMessage(payload("application.ready", { title: document.title || props.name, path, canGoBack: canGoBack(), name: props.name }), targetOrigin);
    window.parent.postMessage(payload("application.navigation", { path, title: document.title || props.name, canGoBack: canGoBack() }), targetOrigin);
    window.parent.postMessage(payload("application.title", { title: document.title || props.name }), targetOrigin);
    window.parent.postMessage(payload("application.lifecycle", { path, canGoBack: canGoBack() }), targetOrigin);
  }, [location, props.name]);

  const requestShellCapability = useCallback((capability: string) => {
    const origin = originRef.current;
    if (!origin) {
      return Promise.resolve({
        capability,
        status: "denied",
        reason: "NOT_CONNECTED",
        detail: "Not hosted in OS Shell.",
      } satisfies ShellPolicyResult);
    }
    seq.current += 1;
    const requestId = `cap-${seq.current}`;
    return new Promise<ShellPolicyResult>((resolve) => {
      pendingRef.current.set(requestId, resolve);
      window.parent.postMessage(
        { channel: CHANNEL, version: VERSION, type: "capability.request", capability, requestId },
        origin,
      );
    });
  }, []);

  const getShellCapabilityStatus = useCallback((capability: string) => {
    const origin = originRef.current;
    if (!origin) {
      return Promise.resolve({
        capability,
        status: "denied",
        reason: "NOT_CONNECTED",
        detail: "Not hosted in OS Shell.",
      } satisfies ShellPolicyResult);
    }
    seq.current += 1;
    const requestId = `status-${seq.current}`;
    return new Promise<ShellPolicyResult>((resolve) => {
      pendingRef.current.set(requestId, resolve);
      window.parent.postMessage(
        { channel: CHANNEL, version: VERSION, type: "capability.status", capability, requestId },
        origin,
      );
    });
  }, []);

  const reportShellExecution = useCallback((capability: string, started: boolean, result: string) => {
    const origin = originRef.current;
    if (!origin) return;
    window.parent.postMessage(
      {
        channel: CHANNEL,
        version: VERSION,
        type: "capability.execution",
        capability,
        executionStarted: started,
        executionResult: result,
      },
      origin,
    );
  }, []);

  const api = useMemo<OsShellApi>(
    () => ({
      connected: Boolean(shellOrigin),
      shellOrigin,
      requestShellCapability,
      getShellCapabilityStatus,
      reportShellExecution,
    }),
    [shellOrigin, requestShellCapability, getShellCapabilityStatus, reportShellExecution],
  );

  return <OsShellContext.Provider value={api}>{props.children ?? null}</OsShellContext.Provider>;
}

/** Request a Shell-mediated capability. Never include tokens or credentials. Never use "*". */
export function requestShellCapability(capability: string, targetOrigin: string, requestId: string) {
  if (!targetOrigin || targetOrigin === "*") return;
  window.parent.postMessage(
    { channel: CHANNEL, version: VERSION, type: "capability.request", capability, requestId },
    targetOrigin,
  );
}

export function getShellCapabilityStatus(capability: string, targetOrigin: string, requestId: string) {
  if (!targetOrigin || targetOrigin === "*") return;
  window.parent.postMessage(
    { channel: CHANNEL, version: VERSION, type: "capability.status", capability, requestId },
    targetOrigin,
  );
}
