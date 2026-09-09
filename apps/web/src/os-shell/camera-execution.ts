/**
 * Application-owned browser camera execution.
 * The Shell never receives this stream. This is not Device Bridge, Production, or Live.
 */
export function translateBrowserCameraError(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: string }).name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "NotAllowedError";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "NotFoundError";
  if (name === "NotReadableError" || name === "TrackStartError") return "NotReadableError";
  if (name === "OverconstrainedError") return "OverconstrainedError";
  if (name === "SecurityError") return "SecurityError";
  return "camera_unavailable";
}

export async function captureBrowserCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error("mediaDevices unavailable");
    error.name = "NotFoundError";
    throw error;
  }
  return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
}

export function releaseCameraStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}
