import { needsSignInHandoff } from "./signin-handoff";

/**
 * Entry choice for mybrandOS opened as an installed App or Space (inside OS Xperience): the
 * person first picks "Sign in with Trust ID" (creator → Studio) or "Continue as guest" (public
 * app). The choice lasts for this App window (sessionStorage), so moving around the public app
 * does not bring the sign-in page back; closing the App does.
 */
const ENTRY_KEY = "mybrandos.entry.choice";
export const ENTRY_PATH = "/auth/start";

export type EntryChoice = "guest" | "creator";

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberEntry(choice: EntryChoice) {
  storage()?.setItem(ENTRY_KEY, choice);
}

export function entryChoice(): EntryChoice | null {
  const value = storage()?.getItem(ENTRY_KEY);
  return value === "guest" || value === "creator" ? value : null;
}

export function forgetEntry() {
  storage()?.removeItem(ENTRY_KEY);
}

/** Installed App / Space: show the sign-in page before the public app until a choice is made. */
export function needsEntryChoice(): boolean {
  return needsSignInHandoff() && entryChoice() === null;
}
