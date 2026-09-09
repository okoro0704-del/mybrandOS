import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { CREATE_LAUNCHER_TYPES } from "@mybrandos/shared";
import { prisma } from "../src/lib/prisma.js";
import { launchCreation } from "../src/services/create-service.js";
import { ensureBook } from "../src/book/ensure.js";
import { ensureVideo } from "../src/video/ensure.js";
import { ensureMusic } from "../src/music/ensure.js";
import { ensureWriting } from "../src/writing/ensure.js";
import { ensureSoftware } from "../src/software/ensure.js";

const OWNER = "TD-MATRIX-OWNER";

async function cleanup() {
  const projects = await prisma.creationProject.findMany({
    where: { ownerId: OWNER },
    select: { id: true, assetId: true },
  });
  if (projects.length) {
    await prisma.creationProject.deleteMany({ where: { ownerId: OWNER } });
  }
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
}

before(cleanup);
after(cleanup);

test("all six creation types route through the Universal Creation Engine", async () => {
  const specialized = ["BOOK", "COURSE", "VIDEO", "MUSIC", "SOFTWARE", "WRITING"] as const;
  assert.ok(specialized.every((type) => CREATE_LAUNCHER_TYPES.includes(type)));

  const launched = [];
  for (const projectType of specialized) {
    const result = await launchCreation({
      ownerId: OWNER,
      projectType,
      mode: "MANUAL",
      title: `${projectType} Matrix`,
    });
    assert.ok(result.project);
    assert.equal(result.project?.projectType, projectType);
    launched.push(result.project!);
  }

  await ensureBook(launched.find((p) => p.projectType === "BOOK")!.id);
  await ensureVideo(launched.find((p) => p.projectType === "VIDEO")!.id);
  await ensureMusic(launched.find((p) => p.projectType === "MUSIC")!.id);
  await ensureWriting(launched.find((p) => p.projectType === "WRITING")!.id);
  await ensureSoftware(launched.find((p) => p.projectType === "SOFTWARE")!.id);

  const types = await prisma.creationProject.findMany({
    where: { ownerId: OWNER },
    select: { projectType: true },
  });
  assert.deepEqual(
    types.map((row) => row.projectType).sort(),
    ["BOOK", "COURSE", "MUSIC", "SOFTWARE", "VIDEO", "WRITING"],
  );

  const parallel = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('MusicCMS','WritingCMS','SoftwareCMS','MusicAsset','WritingAsset','SoftwareAsset')`,
  );
  assert.deepEqual(parallel, []);
});
