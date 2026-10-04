/**
 * Scroll-aware APP bottom navigation.
 * Hysteresis: the bar only flips after travelling NAV_SCROLL_THRESHOLD_PX in one direction
 * from the furthest point reached since the last flip, so finger jitter never toggles it.
 */
export const NAV_SCROLL_THRESHOLD_PX = 28;
export const NAV_TOP_ZONE_PX = 12;

export type NavScrollState = { visible: boolean; anchor: number };

export function initialNavScroll(top = 0): NavScrollState {
  return { visible: true, anchor: Math.max(0, top) };
}

export function reduceNavScroll(
  state: NavScrollState,
  scrollTop: number,
  opts: { threshold?: number; topZone?: number; pinned?: boolean } = {},
): NavScrollState {
  const threshold = opts.threshold ?? NAV_SCROLL_THRESHOLD_PX;
  const topZone = opts.topZone ?? NAV_TOP_ZONE_PX;
  const top = Math.max(0, scrollTop);
  if (top <= topZone || opts.pinned) return { visible: true, anchor: top };
  if (state.visible) {
    const anchor = Math.min(state.anchor, top);
    return top - anchor >= threshold ? { visible: false, anchor: top } : { visible: true, anchor };
  }
  const anchor = Math.max(state.anchor, top);
  return anchor - top >= threshold ? { visible: true, anchor: top } : { visible: false, anchor };
}
