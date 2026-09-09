import type { LifeOsPrimitiveId, PrimitiveCapabilityHealth, PrimitiveHealth } from "@mybrandos/shared";
import {
  LIFEOS_PRIMITIVE_IDS,
  PRIMITIVE_LABELS,
  PRIMITIVE_USER_LABELS,
  isRequiredPrimitive,
  primitiveUserMessage,
} from "@mybrandos/shared";

type Healthish = {
  primitiveId: LifeOsPrimitiveId;
  bound: boolean;
  developmentOnly?: boolean;
  health(): Promise<{ ok: boolean; service: string }>;
};

export const PRIMITIVE_CAPABILITIES: Record<LifeOsPrimitiveId, string[]> = {
  "trust-id": ["oauth", "pkce", "session", "userinfo"],
  elfcom: ["inbox", "notify"],
  "sovereign-drive": ["upload-intent", "store-bytes", "get-bytes"],
  "platform-jobs": ["dispatch", "status"],
  "master-distributor": ["os-deploy"],
  fundzman: ["wallet-summary"],
};

export async function inspectPrimitive(adapter: Healthish): Promise<PrimitiveCapabilityHealth> {
  const lastChecked = new Date().toISOString();
  if (!adapter.bound) {
    return {
      id: adapter.primitiveId,
      bound: false,
      healthy: false,
      capabilities: PRIMITIVE_CAPABILITIES[adapter.primitiveId],
      lastChecked,
      failureReason: adapter.developmentOnly ? "NOT_CONFIGURED" : "UNAVAILABLE",
    };
  }
  try {
    const health = await adapter.health();
    return {
      id: adapter.primitiveId,
      bound: true,
      healthy: health.ok === true,
      capabilities: PRIMITIVE_CAPABILITIES[adapter.primitiveId],
      lastChecked,
      failureReason: health.ok ? null : "UNAVAILABLE",
    };
  } catch (err) {
    return {
      id: adapter.primitiveId,
      bound: true,
      healthy: false,
      capabilities: PRIMITIVE_CAPABILITIES[adapter.primitiveId],
      lastChecked,
      failureReason: err instanceof Error ? err.message : "UNAVAILABLE",
    };
  }
}

export async function collectPrimitiveHealth(primitives: {
  trustId: Healthish;
  elfCom: Healthish;
  dataZone: Healthish;
  platformJobs: Healthish;
  masterDistributor: Healthish;
  fundzMan: Healthish;
}): Promise<PrimitiveHealth[]> {
  const adapters: Healthish[] = [
    primitives.trustId,
    primitives.elfCom,
    primitives.dataZone,
    primitives.platformJobs,
    primitives.masterDistributor,
    primitives.fundzMan,
  ];
  const reports = await Promise.all(adapters.map(inspectPrimitive));
  return LIFEOS_PRIMITIVE_IDS.map((id) => {
    const report = reports.find((item) => item.id === id)!;
    const required = isRequiredPrimitive(report.id);
    return {
      id: report.id,
      label: PRIMITIVE_LABELS[report.id],
      userLabel: PRIMITIVE_USER_LABELS[report.id],
      bound: report.bound,
      ok: report.healthy,
      healthy: report.healthy,
      required,
      optional: !required,
      adapterType: report.bound ? "remote" : "unbound",
      capabilities: report.capabilities,
      lastChecked: report.lastChecked,
      failureReason: report.failureReason,
      detail: report.bound
        ? report.healthy
          ? "Remote primitive healthy"
          : report.failureReason ?? "Remote primitive unhealthy"
        : "Unbound — not configured for this deployment",
      userMessage: primitiveUserMessage(report.id, report.bound, report.healthy),
    };
  });
}

export { PRIMITIVE_LABELS };
