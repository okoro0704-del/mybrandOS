import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TrustIdIdentity } from "@mybrandos/shared";
import { api, setToken } from "../lib/api";

type IdentityState = {
  user: TrustIdIdentity | null;
  loading: boolean;
  enterLocal: (opts?: { trustId?: string; displayName?: string }) => Promise<void>;
  startTrustId: () => Promise<void>;
  completeTrustId: (code: string, state: string) => Promise<void>;
  logout: () => Promise<void>;
};

const IdentityContext = createContext<IdentityState | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TrustIdIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: TrustIdIdentity }>("/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enterLocal = useCallback(async (opts?: { trustId?: string; displayName?: string }) => {
    const data = await api<{ token: string; user: TrustIdIdentity }>("/auth/dev-session", {
      method: "POST",
      body: JSON.stringify(opts ?? {}),
    });
    setToken(data.token);
    setUser(data.user);
  }, []);

  const startTrustId = useCallback(async () => {
    const data = await api<{ url: string }>("/auth/trustid/start");
    window.location.href = data.url;
  }, []);

  const completeTrustId = useCallback(async (code: string, state: string) => {
    const data = await api<{ token: string; user: TrustIdIdentity }>("/auth/trustid/callback", {
      method: "POST",
      body: JSON.stringify({ code, state }),
    });
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, enterLocal, startTrustId, completeTrustId, logout }),
    [user, loading, enterLocal, startTrustId, completeTrustId, logout],
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity() {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error("useIdentity must be used inside IdentityProvider");
  return ctx;
}
