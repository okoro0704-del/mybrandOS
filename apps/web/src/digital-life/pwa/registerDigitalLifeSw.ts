export async function registerDigitalLifeServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw-digital-life.js", { scope: "/" });
    return reg;
  } catch {
    return null;
  }
}
