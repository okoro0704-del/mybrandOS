/** Direction-aware Home chrome — explicit UI states only. */
export type HomeChromeState = "FULL_HOME" | "IMMERSIVE_FEED" | "NAVIGATION_RETURN";

/** Near-top threshold: restore full Home chrome. */
export const HOME_CHROME_TOP_EPS_PX = 20;

/** Ignore sub-threshold movement (finger jitter / bounce). */
export const HOME_CHROME_JITTER_PX = 10;

/** Accumulated travel in one direction before a state change. */
export const HOME_CHROME_ACCUM_PX = 52;

export type HomeChromeScrollSample = {
  scrollY: number;
  prevY: number;
  accum: number;
  lastDir: "up" | "down" | null;
  state: HomeChromeState;
};

export type HomeChromeScrollResult = {
  state: HomeChromeState;
  prevY: number;
  accum: number;
  lastDir: "up" | "down" | null;
};

/**
 * Pure scroll → chrome state step.
 * Callers attach this to the actual scroll owner (window for Personal OS Home).
 */
export function stepHomeChromeScroll(sample: HomeChromeScrollSample): HomeChromeScrollResult {
  const y = Math.max(0, sample.scrollY);
  const delta = y - sample.prevY;

  if (y <= HOME_CHROME_TOP_EPS_PX) {
    return { state: "FULL_HOME", prevY: y, accum: 0, lastDir: null };
  }

  if (Math.abs(delta) < HOME_CHROME_JITTER_PX) {
    return {
      state: sample.state,
      prevY: y,
      accum: sample.accum,
      lastDir: sample.lastDir,
    };
  }

  const dir: "up" | "down" = delta > 0 ? "down" : "up";
  let accum = sample.lastDir === dir ? sample.accum : 0;
  accum += Math.abs(delta);

  if (dir === "down" && accum >= HOME_CHROME_ACCUM_PX) {
    return { state: "IMMERSIVE_FEED", prevY: y, accum: 0, lastDir: dir };
  }

  if (dir === "up" && accum >= HOME_CHROME_ACCUM_PX) {
    return { state: "NAVIGATION_RETURN", prevY: y, accum: 0, lastDir: dir };
  }

  return { state: sample.state, prevY: y, accum, lastDir: dir };
}

export function readWindowScrollY(): number {
  return window.scrollY || document.documentElement.scrollTop || 0;
}
