import { useEffect, useRef } from "react";
import {
  REVEAL_DOUBLE_TAP_MS,
  REVEAL_MOVE_CANCEL_PX,
  isRevealExemptTarget,
} from "./revealChrome";

/**
 * Shell-level double-tap on a neutral surface toggles reveal chrome.
 * Interactive children, swipes, and focused inputs are exempt.
 */
export function useRevealDoubleTap(enabled: boolean, onToggle: () => void) {
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  useEffect(() => {
    if (!enabled) return;
    const root = document.querySelector(".os-phone-frame");
    if (!root) return;

    let lastTs = 0;
    let lastX = 0;
    let lastY = 0;
    let pointerX = 0;
    let pointerY = 0;
    let tracking = false;
    let moved = false;

    const onDown = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType === "mouse" && pe.button !== 0) return;
      if (isRevealExemptTarget(e.target)) {
        tracking = false;
        return;
      }
      tracking = true;
      moved = false;
      pointerX = pe.clientX;
      pointerY = pe.clientY;
    };

    const onMove = (e: Event) => {
      if (!tracking) return;
      const pe = e as PointerEvent;
      if (
        Math.abs(pe.clientX - pointerX) > REVEAL_MOVE_CANCEL_PX ||
        Math.abs(pe.clientY - pointerY) > REVEAL_MOVE_CANCEL_PX
      ) {
        moved = true;
      }
    };

    const onUp = (e: Event) => {
      if (!tracking) return;
      tracking = false;
      if (moved) return;
      if (isRevealExemptTarget(e.target)) return;
      const pe = e as PointerEvent;
      const now = pe.timeStamp || Date.now();
      const dt = now - lastTs;
      const dist = Math.hypot(pe.clientX - lastX, pe.clientY - lastY);
      if (dt > 0 && dt <= REVEAL_DOUBLE_TAP_MS && dist <= REVEAL_MOVE_CANCEL_PX * 2) {
        lastTs = 0;
        onToggleRef.current();
        return;
      }
      lastTs = now;
      lastX = pe.clientX;
      lastY = pe.clientY;
    };

    const onCancel = () => {
      tracking = false;
      moved = true;
    };

    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onCancel);
    return () => {
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onCancel);
    };
  }, [enabled]);
}
