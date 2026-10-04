import type { CameraTrackCapabilities } from "@mybrandos/shared";

export type FacingMode = "user" | "environment";

export type ViewfinderRequest = {
  facingMode: FacingMode;
  deviceId?: string | null;
  audio: boolean;
  width?: number;
  height?: number;
  frameRate?: number;
};

export type CameraOpenError = "permission_denied" | "camera_unavailable" | "camera_busy" | "insecure_context" | "camera_failed";

export function cameraErrorCode(err: unknown): CameraOpenError {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "permission_denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "camera_unavailable";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "camera_busy";
  if (name === "SecurityError") return "insecure_context";
  return "camera_failed";
}

export const CAMERA_ERROR_COPY: Record<CameraOpenError, string> = {
  permission_denied: "Camera access was denied. Allow camera access in your browser settings, then try again.",
  camera_unavailable: "No camera was found on this device.",
  camera_busy: "The camera is in use by another app. Close it and try again.",
  insecure_context: "Camera access needs a secure (https) connection.",
  camera_failed: "The camera could not start.",
};

export async function openViewfinder(req: ViewfinderRequest): Promise<{ stream: MediaStream; audioDenied: boolean }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("camera_unavailable"), { name: "NotFoundError" });
  }
  const video: MediaTrackConstraints = req.deviceId
    ? { deviceId: { exact: req.deviceId } }
    : { facingMode: { ideal: req.facingMode } };
  if (req.width) video.width = { ideal: req.width };
  if (req.height) video.height = { ideal: req.height };
  if (req.frameRate) video.frameRate = { ideal: req.frameRate };
  if (!req.audio) {
    return { stream: await navigator.mediaDevices.getUserMedia({ video, audio: false }), audioDenied: false };
  }
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ video, audio: true }), audioDenied: false };
  } catch (err) {
    // Microphone refusal must not take the camera down; record silently and say so.
    if (cameraErrorCode(err) !== "permission_denied") throw err;
    return { stream: await navigator.mediaDevices.getUserMedia({ video, audio: false }), audioDenied: true };
  }
}

export async function countVideoInputs(): Promise<number> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "videoinput").length;
  } catch {
    return 1;
  }
}

export function trackCapabilities(track: MediaStreamTrack | null | undefined): CameraTrackCapabilities {
  if (!track || typeof track.getCapabilities !== "function") return {};
  try {
    return track.getCapabilities() as unknown as CameraTrackCapabilities;
  } catch {
    return {};
  }
}

/** Applies a device constraint; resolves false instead of pretending when the camera refuses. */
export async function applyDeviceSetting(track: MediaStreamTrack | null | undefined, setting: Record<string, unknown>): Promise<boolean> {
  if (!track || typeof track.applyConstraints !== "function") return false;
  try {
    await track.applyConstraints({ advanced: [setting as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

export function recorderMimeType(hasAudio: boolean): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = hasAudio
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
    : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function recorderCanPause(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof MediaRecorder.prototype.pause === "function";
}

/** Grabs the untouched sensor frame. Filters stay metadata; the original is never baked. */
export async function capturePhotoFrame(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error("camera_not_ready");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("camera_failed");
  ctx.drawImage(video, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("camera_failed"))), "image/jpeg", 0.95);
  });
}

export function stopTracks(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}
