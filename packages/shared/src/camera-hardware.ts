/**
 * Software contract for a future dedicated mybrandOS Camera.
 * No physical hardware is claimed to exist. These interfaces describe
 * what a future Device Bridge participant may report.
 */

import type { AudioDirectionality, HardwareCapabilityState, SpatialPosition } from "./recording.js";

export interface MyBrandOsCameraImagingContract {
  sensorQuality: "UNKNOWN" | "STANDARD" | "HIGH" | "PRO";
  hdr: HardwareCapabilityState;
  stabilization: HardwareCapabilityState;
  autofocus: HardwareCapabilityState;
  subjectTracking: HardwareCapabilityState;
  lowLight: HardwareCapabilityState;
  imageProcessing: HardwareCapabilityState;
  resolutions: Array<{ width: number; height: number; label: string }>;
  frameRates: number[];
}

export interface MyBrandOsCameraAudioContract {
  microphoneArray: HardwareCapabilityState;
  beamforming: HardwareCapabilityState;
  directionalCapture: HardwareCapabilityState;
  noiseSuppression: HardwareCapabilityState;
  echoSuppression: HardwareCapabilityState;
  speechIsolation: HardwareCapabilityState;
  spatialMetadata: HardwareCapabilityState;
  windNoiseHandling: HardwareCapabilityState;
  automaticGainControl: HardwareCapabilityState;
  directionality: AudioDirectionality;
}

export interface MyBrandOsCameraProductionContract {
  trustIdDeviceIdentity: HardwareCapabilityState;
  deviceBridgePairing: HardwareCapabilityState;
  productionAssignment: HardwareCapabilityState;
  cameraState: HardwareCapabilityState;
  microphoneState: HardwareCapabilityState;
  orientation: SpatialPosition;
  position: SpatialPosition;
  health: HardwareCapabilityState;
  synchronization: HardwareCapabilityState;
  lowLatencyProgram: HardwareCapabilityState;
}

/** Full future-hardware contract. Always report UNKNOWN/UNSUPPORTED until real hardware binds. */
export interface MyBrandOsCameraHardwareContract {
  product: "mybrandOS Camera";
  available: false;
  detail: "Dedicated mybrandOS Camera hardware is not manufactured in this software phase.";
  imaging: MyBrandOsCameraImagingContract;
  audio: MyBrandOsCameraAudioContract;
  production: MyBrandOsCameraProductionContract;
}

export function unboundMyBrandOsCameraContract(): MyBrandOsCameraHardwareContract {
  const unknown = "UNKNOWN" as const;
  return {
    product: "mybrandOS Camera",
    available: false,
    detail: "Dedicated mybrandOS Camera hardware is not manufactured in this software phase.",
    imaging: {
      sensorQuality: "UNKNOWN",
      hdr: unknown,
      stabilization: unknown,
      autofocus: unknown,
      subjectTracking: unknown,
      lowLight: unknown,
      imageProcessing: unknown,
      resolutions: [],
      frameRates: [],
    },
    audio: {
      microphoneArray: unknown,
      beamforming: unknown,
      directionalCapture: unknown,
      noiseSuppression: unknown,
      echoSuppression: unknown,
      speechIsolation: unknown,
      spatialMetadata: unknown,
      windNoiseHandling: unknown,
      automaticGainControl: unknown,
      directionality: "UNKNOWN",
    },
    production: {
      trustIdDeviceIdentity: unknown,
      deviceBridgePairing: unknown,
      productionAssignment: unknown,
      cameraState: unknown,
      microphoneState: unknown,
      orientation: "UNKNOWN",
      position: "UNKNOWN",
      health: unknown,
      synchronization: unknown,
      lowLatencyProgram: unknown,
    },
  };
}
