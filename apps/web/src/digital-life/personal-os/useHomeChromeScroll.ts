import { useEffect, useState } from "react";
import {
  HOME_CHROME_TOP_EPS_PX,
  readWindowScrollY,
  stepHomeChromeScroll,
  type HomeChromeState,
} from "./homeChrome";

function readFeedScrollY(): number | null {
  const feed = document.querySelector(".immersive-feed") as HTMLElement | null;
  if (!feed) return null;
  return feed.scrollTop;
}

/**
 * Home-tab only. Prefers ImmersivePostFeed scroller when present;
 * otherwise window/document scroll (search / card sections).
 */
export function useHomeChromeScroll(enabled: boolean): HomeChromeState {
  const [state, setState] = useState<HomeChromeState>("FULL_HOME");

  useEffect(() => {
    if (!enabled) {
      setState("FULL_HOME");
      return;
    }

    const readY = () => {
      const feedY = readFeedScrollY();
      return feedY == null ? readWindowScrollY() : feedY;
    };

    let prevY = readY();
    let accum = 0;
    let lastDir: "up" | "down" | null = null;
    let raf = 0;
    let current: HomeChromeState =
      prevY <= HOME_CHROME_TOP_EPS_PX ? "FULL_HOME" : "NAVIGATION_RETURN";
    setState(current);

    const tick = () => {
      raf = 0;
      const next = stepHomeChromeScroll({
        scrollY: readY(),
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
    const feed = document.querySelector(".immersive-feed");
    feed?.addEventListener("scroll", onScroll, { passive: true });

    const mo = new MutationObserver(() => {
      const nextFeed = document.querySelector(".immersive-feed");
      if (nextFeed && nextFeed !== feed) {
        nextFeed.addEventListener("scroll", onScroll, { passive: true });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.querySelectorAll(".immersive-feed").forEach((el) => {
        el.removeEventListener("scroll", onScroll);
      });
      mo.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [enabled]);

  return enabled ? state : "FULL_HOME";
}
