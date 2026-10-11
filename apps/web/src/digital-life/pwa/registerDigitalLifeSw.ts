export async function registerDigitalLifeServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw-digital-life.js", { scope: "/" });
    // Pick up a new offline worker on every connected load, so a fix to offline behaviour reaches
    // installed Spaces before the person next goes offline.
    if (navigator.onLine) void reg.update().catch(() => undefined);
    return reg;
  } catch {
    return null;
  }
}
