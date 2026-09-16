import { useEffect, useState } from "react";
import {
  HOME_CHROME_TOP_EPS_PX,
  readWindowScrollY,
  stepHomeChromeScroll,
  type HomeChromeState,
} from "./homeChrome";

/**
 * Home-tab only. Scroll owner is the window / document (Personal OS Home
 * is normal document flow — not a nested scroller).
 */
export function useHomeChromeScroll(enabled: boolean): HomeChromeState {
  const [state, setState] = useState<HomeChromeState>("FULL_HOME");

  useEffect(() => {
    if (!enabled) {
      setState("FULL_HOME");
      return;
    }

    let prevY = readWindowScrollY();
    let accum = 0;
    let lastDir: "up" | "down" | null = null;
    let raf = 0;
    let current: HomeChromeState =
      prevY <= HOME_CHROME_TOP_EPS_PX ? "FULL_HOME" : "NAVIGATION_RETURN";
    setState(current);

    const tick = () => {
      raf = 0;
      const next = stepHomeChromeScroll({
        scrollY: readWindowScrollY(),
        prevY,
        accum,
        lastDir,
        state: current,
      });
      prevY = next.prevY;
      accum = next.accum;
      lastDir = next.lastDir;
      if (next.state !== current) {
        current = next.state;
        setState(current);
      }
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(tick);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [enabled]);

  return enabled ? state : "FULL_HOME";
}
