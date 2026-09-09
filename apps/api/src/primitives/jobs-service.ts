import { STUDIO_JOB_TYPES, type StudioJobType } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError } from "@mybrandos/integrations";
import { unavailable } from "../lib/errors.js";

export async function dispatchStudioJob(
  primitives: PrimitiveBindings,
  input: {
    type: StudioJobType | string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
    correlationId?: string;
  },
) {
  try {
    return await primitives.platformJobs.dispatch({
      type: input.type,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
  } catch (err) {
    if (err instanceof PrimitiveError) {
      throw unavailable(err.code, err.message);
    }
    throw unavailable("PLATFORM_JOBS_UNAVAILABLE", "Platform Jobs did not accept the job.");
  }
}

export function isKnownStudioJob(type: string): type is StudioJobType {
  return (STUDIO_JOB_TYPES as readonly string[]).includes(type);
}
