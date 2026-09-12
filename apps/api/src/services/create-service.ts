import type { AssetType, CreateMode } from "@mybrandos/shared";
import { ASSET_TYPE_LABELS, projectTypeFromAsset } from "@mybrandos/shared";
import { createProject } from "../creation/project-service.js";
import { createBlock } from "../creation/block-service.js";

export async function launchCreation(input: {
  ownerId: string;
  assetType?: AssetType;
  projectType?: string;
  mode: CreateMode;
  title?: string;
  /** When WRITING, optional form such as POST for LifeOS Post presentation. */
  writingForm?: string;
}) {
  const projectType = input.projectType || (input.assetType ? projectTypeFromAsset(input.assetType) : "OTHER");
  const title =
    input.title?.trim() ||
    (input.writingForm === "POST"
      ? "New Post"
      : `Untitled ${input.assetType ? ASSET_TYPE_LABELS[input.assetType] : projectType}`);

  if (input.mode === "IMPORT") {
    return { project: null, redirect: "/import" as const };
  }

  const project = await createProject({
    ownerId: input.ownerId,
    title,
    projectType,
    origin: "CREATED_INTERNAL",
    mode: input.mode,
  });

  if (projectType === "BOOK") {
    const { ensureBook } = await import("../book/ensure.js");
    await ensureBook(project.id);
    return { project, redirect: `/create/${project.id}` as const };
  }

  if (projectType === "VIDEO") {
    const { ensureVideo } = await import("../video/ensure.js");
    await ensureVideo(project.id);
    return { project, redirect: `/create/${project.id}` as const };
  }

  if (projectType === "MUSIC") {
    const { ensureMusic } = await import("../music/ensure.js");
    await ensureMusic(project.id);
    return { project, redirect: `/create/${project.id}` as const };
  }

  if (projectType === "WRITING") {
    const { ensureWriting } = await import("../writing/ensure.js");
    await ensureWriting(project.id, { form: input.writingForm });
    return {
      project,
      redirect: `/create/${project.id}${input.writingForm === "POST" ? "?post=1" : ""}` as const,
    };
  }

  if (projectType === "SOFTWARE") {
    const { ensureSoftware } = await import("../software/ensure.js");
    await ensureSoftware(project.id);
    return { project, redirect: `/create/${project.id}` as const };
  }

  if (input.mode === "MANUAL") {
    await createBlock(input.ownerId, project.id, {
      type: "TEXT",
      content: { text: "" },
      metadata: { starter: true },
    });
  }

  return { project, redirect: `/create/${project.id}` as const };
}

export async function getCreationProject(ownerId: string, id: string) {
  const { getProject } = await import("../creation/project-service.js");
  return getProject(ownerId, id);
}
