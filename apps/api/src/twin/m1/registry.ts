/**
 * The only actions Digi Twin can ever perform. Tools are code, not configuration: an AI response,
 * a client field or a delegation cannot add one. Anything not listed here is rejected.
 */
export const TWIN_TOOLS = {
  /** Non-destructive: creates an owner-scoped BroadcastProgram with status DRAFT. */
  CREATE_TV_PROGRAMME_DRAFT: { sensitive: false, requiresApproval: false, stepUp: null },
  /** Makes a draft TV schedule public. Needs a single-use human approval bound to the exact schedule. */
  PUBLISH_TV_SCHEDULE: { sensitive: true, requiresApproval: true, stepUp: null },
  /**
   * Starts a live broadcast. Requires biometric / Master Device step-up, which Trust ID does not
   * provide in production yet (thresholdStatus UNCALIBRATED, padStatus INCOMPLETE): always blocked.
   */
  GO_LIVE: { sensitive: true, requiresApproval: true, stepUp: "biometric" },
} as const;

export type TwinTool = keyof typeof TWIN_TOOLS;

export const DELEGATABLE_TOOLS: readonly TwinTool[] = ["CREATE_TV_PROGRAMME_DRAFT", "PUBLISH_TV_SCHEDULE"];

export function isTwinTool(value: unknown): value is TwinTool {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TWIN_TOOLS, value);
}

/** Step-up that production Trust ID can actually perform today. None. */
export const AVAILABLE_STEP_UPS: readonly string[] = [];

export const DELEGATION_MAX_MINUTES = 60;
export const DELEGATION_DEFAULT_MINUTES = 30;
export const APPROVAL_TTL_MS = 5 * 60 * 1000;

export function twinIdFor(ownerId: string): string {
  return `digi-twin:${ownerId}`;
}
