import { studioReturnPath } from "@mybrandos/shared";

const KEY = "mybrandos_trustid_return";
type ReturnStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function rememberAuthReturn(storage: ReturnStorage, state: string, path: string, hostname: string) {
  storage.setItem(KEY, JSON.stringify({ state, path: studioReturnPath(path, hostname), hostname, expiresAt: Date.now() + 10 * 60 * 1000 }));
}

/** Session storage binds the destination to this tab, host and OAuth transaction. */
export function consumeAuthReturn(storage: ReturnStorage, state: string, hostname: string): string {
  const raw = storage.getItem(KEY);
  storage.removeItem(KEY);
  const pending = raw ? JSON.parse(raw) : null;
  if (!pending || pending.state !== state || pending.hostname !== hostname || !(pending.expiresAt > Date.now())) {
    throw new Error("This sign-in was not started on this app or has expired. Please sign in again on the original app.");
  }
  return studioReturnPath(pending.path, hostname);
}
