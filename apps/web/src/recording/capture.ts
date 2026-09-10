import type { HardwareCapabilityState } from "@mybrandos/shared";

export type LocalCaptureState = {
  camera: HardwareCapabilityState;
  microphone: HardwareCapabilityState;
  screen: HardwareCapabilityState;
  detail: string;
};

export function mapMediaError(err: unknown): { code: string; state: HardwareCapabilityState } {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return { code: "permission_denied", state: "DENIED" };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return { code: "camera_unavailable", state: "UNAVAILABLE" };
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return { code: "device_disconnected", state: "ERROR" };
  }
  return { code: "recording_failed", state: "ERROR" };
}

export async function openCameraMic(opts: {
  video?: boolean;
  audio?: boolean;
  deviceId?: string;
}): Promise<{ stream: MediaStream; state: LocalCaptureState }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("camera_unavailable"), { code: "camera_unavailable" });
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: opts.video === false
        ? false
        : opts.deviceId
          ? { deviceId: { exact: opts.deviceId } }
          : true,
      audio: opts.audio === false ? false : true,
    });
    return {
      stream,
      state: {
        camera: opts.video === false ? "UNAVAILABLE" : "READY",
        microphone: opts.audio === false ? "UNAVAILABLE" : "READY",
        screen: "UNKNOWN",
        detail: "Local capture ready.",
      },
    };
  } catch (err) {
    const mapped = mapMediaError(err);
    throw Object.assign(new Error(mapped.code), { code: mapped.code, state: mapped.state });
  }
}

export async function openScreen(): Promise<{ stream: MediaStream; state: LocalCaptureState }> {
  const display = navigator.mediaDevices?.getDisplayMedia;
  if (!display) {
    throw Object.assign(new Error("screen_capture_unavailable"), { code: "screen_capture_unavailable" });
  }
  try {
    const stream = await display.call(navigator.mediaDevices, { video: true, audio: false });
    return {
      stream,
      state: {
        camera: "UNKNOWN",
        microphone: "UNAVAILABLE",
        screen: "READY",
        detail: "Screen capture ready.",
      },
    };
  } catch (err) {
    const mapped = mapMediaError(err);
    throw Object.assign(new Error("screen_capture_unavailable"), {
      code: "screen_capture_unavailable",
      state: mapped.state === "DENIED" ? "DENIED" : "UNAVAILABLE",
    });
  }
}

export function recordStream(
  stream: MediaStream,
  opts?: { mimeType?: string },
): {
  recorder: MediaRecorder;
  done: Promise<Blob>;
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
} {
  const mimeType =
    opts?.mimeType ||
    (MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "");
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error("recording_failed"));
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "application/octet-stream" }));
  });
  return {
    recorder,
    done,
    start: () => recorder.start(1000),
    stop: () => {
      if (recorder.state !== "inactive") recorder.stop();
    },
    pause: () => {
      if (recorder.state === "recording") recorder.pause();
    },
    resume: () => {
      if (recorder.state === "paused") recorder.resume();
    },
  };
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
