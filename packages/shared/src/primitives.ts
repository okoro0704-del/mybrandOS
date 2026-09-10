/** Canonical LifeOS Core Shell primitive ids (Phase F — 6 engines). Mirrors LifeOS `LIFEOS_PRIMITIVE_IDS`. */
export const LIFEOS_PRIMITIVE_IDS = [
  "trust-id",
  "elfcom",
  "sovereign-drive",
  "platform-jobs",
  "master-distributor",
  "fundzman",
] as const;

export type LifeOsPrimitiveId = (typeof LIFEOS_PRIMITIVE_IDS)[number];

/** Informal aliases — never treat these as independent primitives. */
export const PRIMITIVE_ALIASES = {
  identity: "trust-id",
  messaging: "elfcom",
  storage: "sovereign-drive",
  datazone: "sovereign-drive",
  jobs: "platform-jobs",
  billing: "fundzman",
  wallet: "fundzman",
} as const;

export type PrimitiveAlias = keyof typeof PRIMITIVE_ALIASES;

export function resolvePrimitiveId(id: string): LifeOsPrimitiveId | null {
  if ((LIFEOS_PRIMITIVE_IDS as readonly string[]).includes(id)) return id as LifeOsPrimitiveId;
  if (id in PRIMITIVE_ALIASES) return PRIMITIVE_ALIASES[id as PrimitiveAlias];
  return null;
}

export const PRIMITIVE_LABELS: Record<LifeOsPrimitiveId, string> = {
  "trust-id": "Trust ID Engine",
  elfcom: "ElfCom Engine",
  "sovereign-drive": "Sovereign Drive / DataZone",
  "platform-jobs": "Platform Jobs Engine",
  "master-distributor": "Master Distributor Engine",
  fundzman: "FundzMan Engine",
};

export interface PrimitiveCapabilityHealth {
  id: LifeOsPrimitiveId;
  bound: boolean;
  healthy: boolean;
  capabilities: string[];
  lastChecked: string;
  failureReason: string | null;
}

export const REQUIRED_PRIMITIVES: LifeOsPrimitiveId[] = ["trust-id", "sovereign-drive", "platform-jobs"];

export const OPTIONAL_PRIMITIVES: LifeOsPrimitiveId[] = ["elfcom", "master-distributor", "fundzman"];

export const PRIMITIVE_USER_LABELS: Record<LifeOsPrimitiveId, string> = {
  "trust-id": "Sign-in",
  elfcom: "Messaging",
  "sovereign-drive": "File storage",
  "platform-jobs": "Background processing",
  "master-distributor": "App deployment",
  fundzman: "Payments",
};

export function isRequiredPrimitive(id: LifeOsPrimitiveId): boolean {
  return REQUIRED_PRIMITIVES.includes(id);
}

export function primitiveUserMessage(id: LifeOsPrimitiveId, bound: boolean, healthy: boolean): string {
  if (bound && healthy) {
    switch (id) {
      case "trust-id":
        return "Sign-in is connected.";
      case "elfcom":
        return "Messaging is available.";
      case "sovereign-drive":
        return "File storage is available.";
      case "platform-jobs":
        return "Background processing is available.";
      case "master-distributor":
        return "App deployment is available.";
      case "fundzman":
        return "Payments are connected.";
    }
  }
  switch (id) {
    case "trust-id":
      return "Sign-in is currently unavailable.";
    case "elfcom":
      return "Messaging is currently unavailable.";
    case "sovereign-drive":
      return "File storage is currently unavailable. Your work has not been lost.";
    case "platform-jobs":
      return "Background processing is currently unavailable. This work was not queued.";
    case "master-distributor":
      return "App deployment is currently unavailable. Creating and publishing still work.";
    case "fundzman":
      return "Payments are currently unavailable. No balance is shown.";
  }
}

export const STUDIO_JOB_TYPES = [
  "import.manuscript",
  "import.course",
  "import.media",
  "import.bulk",
  "ai.invoke",
  "media.transcode",
  "media.video",
  "video.render",
  "video.live.finalize",
  "video.live.adapt",
  "video.live.thumbnail",
  "video.adapt",
  "video.highlight",
  "media.audio",
  "video.process",
  "audio.process",
  "audio.waveform",
  "recording.finalize",
  "program.render",
  "preview.prepare",
  "music.mix",
  "media.export",
  "distribution.fan-out",
  "asset.bulk",
  "transform.long",
] as const;

export type StudioJobType = (typeof STUDIO_JOB_TYPES)[number];

export const IMPORT_JOB_STATUSES = ["REQUESTED", "QUEUED", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export const APP_CAPABILITY_IDS = [
  "identity",
  "storage",
  "messaging",
  "jobs",
  "payments",
  "deployment",
] as const;
export type AppCapabilityId = (typeof APP_CAPABILITY_IDS)[number];

export const APP_CAPABILITY_PRIMITIVE: Record<AppCapabilityId, LifeOsPrimitiveId> = {
  identity: "trust-id",
  storage: "sovereign-drive",
  messaging: "elfcom",
  jobs: "platform-jobs",
  payments: "fundzman",
  deployment: "master-distributor",
};

export interface AppCapability {
  id: AppCapabilityId;
  primitive: LifeOsPrimitiveId;
  available: boolean;
  detail: string;
}

export function applicationCapabilities(
  health: Array<{ id: string; bound: boolean; healthy: boolean; userMessage?: string; failureReason?: string | null }>,
): AppCapability[] {
  return APP_CAPABILITY_IDS.map((id) => {
    const primitive = APP_CAPABILITY_PRIMITIVE[id];
    const report = health.find((item) => item.id === primitive);
    const available = Boolean(report?.bound && report.healthy);
    return {
      id,
      primitive,
      available,
      detail: report?.userMessage || report?.failureReason || (available ? "Available" : "Unavailable"),
    };
  });
}
