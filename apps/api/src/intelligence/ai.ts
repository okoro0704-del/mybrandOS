import type { PrimitiveBindings } from "@mybrandos/integrations";
import { prisma } from "../lib/prisma.js";
import { unavailable } from "../lib/errors.js";
import { requireAsset } from "./access.js";
import { getAssetIntelligence } from "./studio.js";
import { recordActivity } from "../services/asset-service.js";
import { writeJson } from "../lib/json.js";

export async function invokeAssetAi(
  userId: string,
  assetId: string,
  input: { actionType: string; instruction?: string; includeContent?: boolean },
  primitives: PrimitiveBindings,
) {
  const access = await requireAsset(userId, assetId, "ai");
  const intel = await getAssetIntelligence(userId, assetId, primitives);
  const health = primitives.ai.health();
  if (!health.available) {
    if (access.asset.sourceProjectId) {
      await prisma.aiAction.create({
        data: {
          projectId: access.asset.sourceProjectId,
          userId,
          actionType: input.actionType,
          input: writeJson({ assetId, includeContent: Boolean(input.includeContent) }),
          output: writeJson({ detail: health.detail }),
          provider: health.provider,
          status: "unavailable",
        },
      }).catch(() => undefined);
    }
    throw unavailable("ai_unavailable", health.detail);
  }

  let content = "";
  if (input.includeContent && access.asset.sourceProjectId && access.role !== "VIEWER") {
    const blocks = await prisma.contentBlock.findMany({
      where: { projectId: access.asset.sourceProjectId },
      take: 8,
      orderBy: { position: "asc" },
    });
    content = blocks
      .map((b) => String(JSON.parse(b.content || "{}").text ?? ""))
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000);
  }

  const result = await primitives.ai.invoke({
    actionType: input.actionType,
    instruction: [
      input.instruction,
      `Asset: ${intel.asset.title} (${intel.asset.assetType}).`,
      `Origin: ${intel.asset.origin}. First-class: yes.`,
      `Health: ${intel.health.state}.`,
      `Capabilities: ${intel.capabilities.filter((c) => c.available).map((c) => c.capability).join(", ")}.`,
      `Relationships: ${intel.lineage.children.length} derived, ${intel.lineage.parents.length} sources.`,
      content ? `Authorized excerpt:\n${content}` : "Content was not included.",
    ]
      .filter(Boolean)
      .join("\n"),
    projectTitle: intel.asset.title,
    projectType: intel.asset.assetType,
    projectDescription: intel.asset.description,
  });

  if (!result.available) {
    throw unavailable("ai_unavailable", result.detail);
  }

  await recordActivity({
    ownerId: access.ownerId,
    kind: "ai",
    title: `AI ${input.actionType} on ${access.asset.title}`,
    detail: result.provider,
    assetId,
  });

  return { text: result.text, provider: result.provider, contentIncluded: Boolean(content) };
}
