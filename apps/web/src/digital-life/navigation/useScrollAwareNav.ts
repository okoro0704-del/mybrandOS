import { useEffect, useRef, useState } from "react";
import { initialNavScroll, reduceNavScroll } from "./scrollAwareNav";

const NAV_SELECTOR = ".os-bottom-nav";
/** Scrolls this long after the last user input (fling momentum, snap) still count as the user's. */
const USER_SCROLL_WINDOW_MS = 1200;
const USER_INPUT_EVENTS = ["touchstart", "touchmove", "wheel", "pointerdown", "keydown"] as const;

function keyboardFocusInNav(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  if (!active.closest(NAV_SELECTOR)) return false;
  try {
    return active.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** Observes any APP scroller (feed, page, surface) in the capture phase; nested comment lists opt out. */
export function useScrollAwareNav(enabled: boolean, resetKey: string): boolean {
  const [visible, setVisible] = useState(true);
  const stateRef = useRef(initialNavScroll());
  const targetRef = useRef<Element | null>(null);

  useEffect(() => {
    stateRef.current = initialNavScroll();
    targetRef.current = null;
    setVisible(true);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled) {
      setVisible(true);
      return;
    }
    const lastTop = new WeakMap<Element, number>();
    let lastInputAt = -Infinity;
    const onInput = () => {
      lastInputAt = performance.now();
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      const el = target === document ? document.scrollingElement : target instanceof Element ? target : null;
      if (!el) return;
      if (el.closest("[data-scroll-chrome='ignore']") || el.closest(NAV_SELECTOR)) return;
      // Programmatic positioning (restoring a post, auto-advance) is not the user changing direction.
      if (el.closest("[data-scroll-programmatic='true']") || performance.now() - lastInputAt > USER_SCROLL_WINDOW_MS) {
        lastTop.set(el, el.scrollTop);
        if (targetRef.current === el) stateRef.current = { visible: stateRef.current.visible, anchor: el.scrollTop };
        return;
      }
      if (targetRef.current !== el) {
        targetRef.current = el;
        // A single event can carry a whole flick, so the anchor is where this scroller was before it, not after.
        stateRef.current = { visible: stateRef.current.visible, anchor: lastTop.get(el) ?? 0 };
      }
      lastTop.set(el, el.scrollTop);
      const next = reduceNavScroll(stateRef.current, el.scrollTop, { pinned: keyboardFocusInNav() });
      stateRef.current = next;
      setVisible(next.visible);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(NAV_SELECTOR)) return;
      stateRef.current = { visible: true, anchor: stateRef.current.anchor };
      setVisible(true);
    };
    for (const type of USER_INPUT_EVENTS) document.addEventListener(type, onInput, { capture: true, passive: true });
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("focusin", onFocusIn);
    return () => {
      for (const type of USER_INPUT_EVENTS) document.removeEventListener(type, onInput, { capture: true });
      document.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [enabled]);

  return visible;
}
