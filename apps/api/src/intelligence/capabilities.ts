import {
  originDoesNotLimitCapability,
  TRANSFORMATION_CATALOG,
  type AssetAction,
  type CapabilityState,
} from "@mybrandos/shared";
import { roleCan, type ProjectRole } from "@mybrandos/shared";
import type { Asset as DbAsset } from "@prisma/client";

export function computeCapabilities(
  asset: DbAsset,
  role: ProjectRole,
  extras: {
    hasProject: boolean;
    hasFile: boolean;
    published: boolean;
    formatBlocked?: string;
    jobsBound?: boolean;
    storageBound?: boolean;
    messagingBound?: boolean;
    moneyBound?: boolean;
    deployBound?: boolean;
    liveBound?: boolean;
  },
): CapabilityState[] {
  originDoesNotLimitCapability(asset.origin);
  const canWrite = roleCan(role, "write");
  const canPublish = roleCan(role, "publish");
  const canAdmin = roleCan(role, "admin");

  return [
    { capability: "VIEW", available: true },
    {
      capability: "EDIT",
      available: canWrite && extras.hasProject && !extras.formatBlocked,
      reason: extras.formatBlocked
        ? extras.formatBlocked
        : extras.hasProject
          ? canWrite
            ? undefined
            : "Your role cannot edit this asset."
          : "Open or create a working project to edit.",
    },
    {
      capability: "PUBLISH",
      available: canPublish && asset.status !== "ARCHIVED",
      reason: canPublish ? (asset.status === "ARCHIVED" ? "Archived assets cannot be published." : undefined) : "Only the owner can publish.",
    },
    {
      capability: "DISTRIBUTE",
      available: extras.published && canPublish,
      reason: extras.published
        ? extras.jobsBound
          ? undefined
          : "You can present this in Personal Space. External distribution needs background processing."
        : "Publish the asset before distributing.",
    },
    {
      capability: "MONETIZE",
      available: extras.published && canAdmin,
      reason: extras.published
        ? extras.moneyBound
          ? undefined
          : "You can define an offer. Payments are currently unavailable."
        : "Publish the asset before connecting commerce.",
    },
    {
      capability: "DOWNLOAD",
      available: extras.hasFile && extras.storageBound !== false,
      reason: extras.hasFile
        ? extras.storageBound === false
          ? "File storage is currently unavailable. Your work has not been lost."
          : undefined
        : "No file is attached yet.",
    },
    {
      capability: "TRANSFORM",
      available: canWrite,
      reason: canWrite ? undefined : "Your role cannot create derived work.",
    },
    {
      capability: "SHARE",
      available: extras.published,
      reason: extras.published
        ? extras.messagingBound
          ? undefined
          : "Personal Space sharing works. Messaging is currently unavailable."
        : "Publish to Personal Space before sharing publicly.",
    },
    {
      capability: "ANALYZE",
      available: false,
      reason: extras.published
        ? "Live analytics are not connected."
        : "Publish the asset to create a stable analytics identity.",
    },
    {
      capability: "LIVE",
      available: Boolean(extras.liveBound) && asset.assetType === "VIDEO",
      reason:
        asset.assetType !== "VIDEO"
          ? "Go Live is part of Video Studio."
          : extras.liveBound
            ? undefined
            : "Live broadcasting is not configured for this environment.",
    },
  ];
}

export function computeActions(
  asset: DbAsset,
  capabilities: CapabilityState[],
  extras: { hasProject: boolean },
): AssetAction[] {
  const cap = (name: CapabilityState["capability"]) => capabilities.find((c) => c.capability === name);
  const edit = cap("EDIT");
  const publish = cap("PUBLISH");
  const transform = cap("TRANSFORM");
  const catalog = TRANSFORMATION_CATALOG[asset.assetType] ?? [];

  const actions: AssetAction[] = [
    {
      id: "open",
      label: extras.hasProject
        ? asset.assetType === "BOOK"
          ? "Open Book Studio"
          : asset.assetType === "COURSE"
            ? "Open Course Studio"
            : asset.assetType === "VIDEO"
              ? "Open Video Studio"
              : asset.assetType === "MUSIC"
                ? "Open Music Studio"
                : asset.assetType === "WRITING"
                  ? "Open Writing Studio"
                  : asset.assetType === "SOFTWARE"
                    ? "Open Software Studio"
                    : "Open workspace"
        : "Open",
      capability: "VIEW",
      available: extras.hasProject,
      href: extras.hasProject && asset.sourceProjectId ? `/create/${asset.sourceProjectId}` : `/assets/${asset.id}`,
      reason: extras.hasProject ? undefined : "No source project yet. Derive or import into a project to edit.",
    },
    {
      id: "edit",
      label: "Edit",
      capability: "EDIT",
      available: Boolean(edit?.available),
      href: asset.sourceProjectId ? `/create/${asset.sourceProjectId}` : undefined,
      reason: edit?.reason,
    },
    {
      id: "publish",
      label: asset.status === "PUBLISHED" ? "Published" : "Publish",
      capability: "PUBLISH",
      available: Boolean(publish?.available) && asset.status !== "PUBLISHED",
      reason: asset.status === "PUBLISHED" ? "Already published." : publish?.reason,
    },
    {
      id: "sell",
      label: "Sell / Create Offer",
      capability: "MONETIZE",
      available: Boolean(cap("MONETIZE")?.available),
      href: "/commerce",
      reason: cap("MONETIZE")?.reason ?? "Create an offer around this Asset. Money movement stays on FundzMan.",
    },
    {
      id: "distribute",
      label: "Distribute",
      capability: "DISTRIBUTE",
      available: Boolean(cap("DISTRIBUTE")?.available),
      href: "/distribution",
      reason: cap("DISTRIBUTE")?.reason,
    },
    {
      id: "analyze",
      label: "Analyze",
      capability: "ANALYZE",
      available: false,
      reason: cap("ANALYZE")?.reason ?? "Live analytics are not connected.",
    },
    {
      id: "preview",
      label: "Preview",
      capability: "VIEW",
      available: extras.hasProject,
      href: extras.hasProject && asset.sourceProjectId ? `/create/${asset.sourceProjectId}` : `/assets/${asset.id}`,
      reason: extras.hasProject ? undefined : "Open a project to preview content.",
    },
    {
      id: "personal-space",
      label: "View in Personal Space",
      capability: "SHARE",
      available: Boolean(cap("SHARE")?.available),
      href: "/personal-space",
      reason: cap("SHARE")?.reason,
    },
    {
      id: "archive",
      label: "Archive",
      capability: "CUSTOM",
      available: asset.status !== "ARCHIVED",
      reason: asset.status === "ARCHIVED" ? "Already archived." : undefined,
    },
  ];

  if (asset.assetType === "VIDEO") {
    const live = cap("LIVE");
    actions.push({
      id: "go-live",
      label: "Go Live",
      capability: "LIVE",
      available: Boolean(live?.available),
      href: asset.sourceProjectId ? `/create/${asset.sourceProjectId}` : undefined,
      reason: live?.reason,
    });
  }

  for (const item of catalog) {
    actions.push({
      id: item.id,
      label: item.label,
      capability: "TRANSFORM",
      available: Boolean(transform?.available) && item.available,
      transformationType: item.targetType,
      reason: !transform?.available ? transform?.reason : item.reason,
    });
  }

  return actions;
}
