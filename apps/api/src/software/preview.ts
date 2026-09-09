import { softwarePreviewState } from "@mybrandos/shared";
import type { PrimitiveBindings } from "@mybrandos/integrations";
import { PrimitiveError } from "@mybrandos/integrations";
import { requireSoftwarePermission } from "./permissions.js";
import { recordSoftwareEvent } from "./events.js";
import { previewSoftware } from "./publish.js";

export async function requestSoftwarePreviewBuild(
  userId: string,
  projectId: string,
  primitives: PrimitiveBindings,
) {
  await requireSoftwarePermission(userId, projectId, "READ");
  const preview = await previewSoftware(userId, projectId);
  try {
    const dispatched = await primitives.platformJobs.dispatch({
      type: "software.preview",
      payload: { ownerId: userId, projectId },
      idempotencyKey: `software-preview-${projectId}-${Date.now()}`,
      correlationId: userId,
    });
    if (!dispatched.jobId) {
      return {
        ...preview,
        preview: {
          ...softwarePreviewState(),
          build: {
            status: "unavailable" as const,
            platformJobId: null,
            previewUrl: null,
            detail: "processing_unavailable. Preview was not queued locally.",
          },
        },
      };
    }
    await recordSoftwareEvent({
      projectId,
      actorId: userId,
      kind: "preview_requested",
      title: "Preview build requested",
      detail: "Queued through Platform Jobs. Code was not executed in the API.",
    });
    return {
      ...preview,
      preview: {
        ...softwarePreviewState(),
        build: {
          status: "queued" as const,
          platformJobId: dispatched.jobId,
          previewUrl: null,
          detail: "Preview build queued. Production was not published.",
        },
      },
    };
  } catch (err) {
    const detail =
      err instanceof PrimitiveError
        ? `processing_unavailable. ${err.message}`
        : "processing_unavailable. Preview builds are not configured.";
    return {
      ...preview,
      preview: {
        ...softwarePreviewState(),
        build: { status: "unavailable" as const, platformJobId: null, previewUrl: null, detail },
      },
    };
  }
}
