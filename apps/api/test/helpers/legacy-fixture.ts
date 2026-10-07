import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { dependencyOrder } from "../../src/data/sqlite-import.js";

/**
 * Sanitized synthetic legacy SQLite dataset with the SAME shape as the production rehearsal
 * (53 tables, 332 rows, same per-table counts, same legacy social totals). Every value is
 * generated — no production data. Exercises NULL vs "", Unicode, ms timestamps, enums,
 * booleans, floats, unique and composite-unique keys, FK chains, and legacy social JSON.
 */
export const PRODUCTION_SHAPE: Record<string, number> = {
  Activity: 74, Asset: 26, BookChapter: 1, BookMetadata: 1, ContentBlock: 28, CourseMetadata: 1,
  CreationProject: 33, DigiAiDraftIdempotency: 2, DigiAiPublishIdempotency: 1, DistributionIntent: 12,
  ImportJob: 23, PersonalSpace: 3, ProductionDevice: 8, ProductionSession: 8, ProductionSource: 40,
  ProgramOutput: 1, ProjectFile: 22, ProjectMember: 33, RecordingSession: 1, RecordingTrack: 2,
  VideoMetadata: 4, VideoScene: 4, WritingMetadata: 4,
};
/** Legacy social totals observed in the production rehearsal. */
export const SOCIAL_SHAPE = { assets: 11, comments: 29, lovers: 11, views: 11_683, plays: 1_966 };

export const apiRoot = fileURLToPath(new URL("../..", import.meta.url));

type DmmfField = { name: string; kind: string; type: string; isRequired: boolean; isId: boolean; isUnique: boolean; hasDefaultValue: boolean; isUpdatedAt: boolean; relationFromFields?: string[] };
type DmmfModel = { name: string; fields: DmmfField[] };
type LegacyModule = {
  PrismaClient: new (o: { datasourceUrl: string }) => Record<string, unknown> & { $disconnect(): Promise<void>; $executeRawUnsafe(q: string, ...v: unknown[]): Promise<number> };
  Prisma: { dmmf: { datamodel: { models: DmmfModel[]; enums: Array<{ name: string; values: Array<{ name: string }> }> } } };
};

export async function legacyModule(): Promise<LegacyModule> {
  return (await import(pathToFileURL(join(apiRoot, "prisma", "legacy-sqlite", "client", "index.js")).href)) as LegacyModule;
}

export function sha256File(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function legacySocialAnalytics(index: number) {
  // 11 assets: comments 29 (3,3,3,3,3,3,3,2,2,2,2), one lover each, views/plays split exactly.
  const comments = index < 7 ? 3 : 2;
  const views = index === 0 ? SOCIAL_SHAPE.views - 10 * 1062 : 1062;
  const plays = index === 0 ? SOCIAL_SHAPE.plays - 10 * 178 : 178;
  return JSON.stringify({
    views,
    plays,
    completions: index,
    loves: 1,
    engagementScore: views + plays * 3,
    lovedBy: [`guest:${(index + 1).toString(16).padStart(32, "0")}`],
    comments: Array.from({ length: comments }, (_, c) => ({
      id: `c_fixture_${index}_${c}`,
      body: c === 1 ? `Ünïcødé ✓ “quoted” comment ${index}` : `comment ${index}.${c}`,
      authorId: `guest:${(index * 10 + c).toString(16).padStart(32, "0")}`,
      displayName: `Guest ${index}${c}`,
      createdAt: new Date(Date.UTC(2026, 8, 1, 12, 0, 0, 0) + (index * 10 + c) * 60_123).toISOString(),
      status: c === 2 ? "HIDDEN" : "VISIBLE",
    })),
    customKeptKey: { nested: [1, "two", null], at: index },
  });
}

/** Create an empty legacy SQLite file (frozen schema) and seed the production-shaped dataset. */
export async function buildLegacyFixture(path: string, shape: Record<string, number> = PRODUCTION_SHAPE) {
  const push = spawnSync("npx", ["prisma", "db", "push", "--schema", "prisma/legacy-sqlite/schema.prisma", "--skip-generate"], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: `file:${path.replace(/\\/g, "/")}` },
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 180_000,
  });
  if (push.status !== 0) throw new Error(`db push failed: ${push.stdout}\n${push.stderr}`);
  const mod = await legacyModule();
  const db = new mod.PrismaClient({ datasourceUrl: `file:${path.replace(/\\/g, "/")}` });
  const enums = new Map(mod.Prisma.dmmf.datamodel.enums.map((e) => [e.name, e.values.map((v) => v.name)]));
  const models = mod.Prisma.dmmf.datamodel.models;
  const byName = new Map(models.map((m) => [m.name, m]));
  const created = new Map<string, string[]>();
  try {
    for (const name of dependencyOrder(models as never)) {
      const n = shape[name] ?? 0;
      const model = byName.get(name)!;
      created.set(name, []);
      if (n === 0) continue;
      const fkFields = new Map<string, { parent: string; unique: boolean }>();
      for (const rel of model.fields.filter((f) => f.kind === "object" && f.relationFromFields?.length)) {
        for (const from of rel.relationFromFields!) {
          const fk = model.fields.find((f) => f.name === from)!;
          fkFields.set(from, { parent: rel.type, unique: fk.isUnique });
        }
      }
      const rows: Array<Record<string, unknown>> = [];
      for (let i = 0; i < n; i += 1) {
        const data: Record<string, unknown> = {};
        for (const f of model.fields) {
          if (f.kind === "object" || f.isUpdatedAt) continue;
          const fk = fkFields.get(f.name);
          if (f.isId) {
            data[f.name] = `${name.toLowerCase()}-${String(i + 1).padStart(3, "0")}`;
          } else if (fk) {
            const parents = created.get(fk.parent) ?? [];
            if (!parents.length) {
              if (f.isRequired) throw new Error(`${name}.${f.name} needs ${fk.parent} rows`);
              data[f.name] = null;
            } else {
              if (fk.unique && i >= parents.length) throw new Error(`${name}.${f.name} is unique but only ${parents.length} ${fk.parent} rows`);
              data[f.name] = fk.unique ? parents[i] : parents[i % parents.length];
            }
          } else if (!f.isRequired) {
            data[f.name] = i % 3 === 0 ? value(name, f, i, enums) : i % 3 === 1 || f.isUnique || f.type !== "String" ? null : "";
          } else if (f.hasDefaultValue && i % 2 === 0) {
            continue; // let the column default apply on half the rows
          } else {
            data[f.name] = value(name, f, i, enums);
          }
        }
        if (name === "Asset") data.analytics = i < SOCIAL_SHAPE.assets ? legacySocialAnalytics(i) : i % 2 ? "{}" : JSON.stringify({ customOnly: i });
        rows.push(data);
        created.get(name)!.push(data.id as string);
      }
      await (db[name.charAt(0).toLowerCase() + name.slice(1)] as { createMany(a: { data: unknown[] }): Promise<unknown> }).createMany({ data: rows });
    }
  } finally {
    await db.$disconnect();
  }
  return { path, sha256: sha256File(path), rows: Object.values(shape).reduce((a, b) => a + b, 0) };
}

function value(model: string, f: DmmfField, i: number, enums: Map<string, string[]>): unknown {
  if (f.kind === "enum") {
    const values = enums.get(f.type)!;
    return values[i % values.length];
  }
  switch (f.type) {
    case "String":
      return `${model}.${f.name}#${i} — ünïcødé ✓`;
    case "Int":
      return i * 3 + 1;
    case "Float":
      return i + 0.25;
    case "Boolean":
      return i % 2 === 0;
    case "DateTime":
      return new Date(Date.UTC(2026, 8, 1, 10, 0, 0, 0) + i * 61_123);
    default:
      throw new Error(`fixture: unsupported type ${f.type}`);
  }
}

/** Insert a row that violates a foreign key (FK enforcement off), for the fk-failure test. */
export async function injectForeignKeyViolation(path: string) {
  const mod = await legacyModule();
  const db = new mod.PrismaClient({ datasourceUrl: `file:${path.replace(/\\/g, "/")}` });
  try {
    await db.$executeRawUnsafe(`PRAGMA foreign_keys = OFF`);
    await db.$executeRawUnsafe(
      `INSERT INTO "ContentBlock" (id, projectId, type, position, content, metadata, createdAt, updatedAt) VALUES ('orphan-block', 'missing-project', 'TEXT', 0, '{}', '{}', 0, 0)`,
    );
  } finally {
    await db.$disconnect();
  }
}
