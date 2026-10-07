import { createHash } from "node:crypto";

/**
 * ONE canonical row representation shared by source (SQLite, via the legacy Prisma client)
 * and target (PostgreSQL, via the current Prisma client). Both clients hand us typed JS values
 * for the same Prisma field types, and both sides go through this exact encoder, so equal
 * canonical hashes mean logically identical rows — never a comparison of raw storage formats.
 *
 * Encoding (every value is tagged, so 0 / "0" / false / null / "" never collide):
 *   null/undefined → null            String  → ["s", text]   (exact UTF-8 text; JSON-in-text is
 *   Boolean → ["b", true|false]                               compared byte-for-byte on purpose)
 *   Int     → ["i", "<decimal>"]     BigInt  → ["i", "<decimal>"]
 *   Float   → ["f", "<shortest round-trip repr>"]  (-0 → "-0", NaN/±Infinity spelled out)
 *   Decimal → ["d", "<normalized decimal>"]        (no exponent, no trailing zeros)
 *   DateTime→ ["t", "<ISO-8601 UTC, ms>"]
 *   Json    → ["j", <canonical JSON: keys sorted recursively, arrays in order>]
 *   Bytes   → ["x", "<base64>"]
 *   Enum    → ["e", "<value>"]
 * Row   = JSON array of [fieldName, encoded] for every scalar/enum field, in schema order.
 * Table = rows sorted by the canonical encoding of their primary key (code-point order, so
 *         database collations never affect the order), joined with "\n", then SHA-256.
 */

export type FieldSpec = { name: string; kind: string; type: string };
export type ModelSpec = { name: string; fields: readonly FieldSpec[]; primaryKey: string[] };

type Tagged = null | [string, unknown];

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = canonicalJson((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

function floatRepr(n: number) {
  if (Object.is(n, -0)) return "-0";
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
  return String(n);
}

function decimalRepr(v: unknown) {
  const text = typeof v === "object" && v !== null && "toFixed" in v ? (v as { toFixed(): string }).toFixed() : String(v);
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`non-canonicalizable decimal ${text}`);
  const [int, frac = ""] = text.split(".");
  const f = frac.replace(/0+$/, "");
  const i = int.replace(/^(-?)0+(?=\d)/, "$1");
  return f ? `${i}.${f}` : i === "-0" ? "0" : i;
}

export function encodeValue(field: FieldSpec, value: unknown): Tagged {
  if (value === null || value === undefined) return null;
  if (field.kind === "enum") return ["e", String(value)];
  switch (field.type) {
    case "String":
      if (typeof value !== "string") throw new Error(`${field.name}: expected string`);
      return ["s", value];
    case "Boolean":
      if (typeof value !== "boolean") throw new Error(`${field.name}: expected boolean`);
      return ["b", value];
    case "Int":
    case "BigInt":
      if (typeof value !== "number" && typeof value !== "bigint") throw new Error(`${field.name}: expected integer`);
      if (typeof value === "number" && !Number.isInteger(value)) throw new Error(`${field.name}: non-integer ${value}`);
      return ["i", value.toString()];
    case "Float":
      if (typeof value !== "number") throw new Error(`${field.name}: expected number`);
      return ["f", floatRepr(value)];
    case "Decimal":
      return ["d", decimalRepr(value)];
    case "DateTime": {
      const d = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(d.getTime())) throw new Error(`${field.name}: invalid date`);
      return ["t", d.toISOString()];
    }
    case "Json":
      return ["j", canonicalJson(typeof value === "string" ? JSON.parse(value) : value)];
    case "Bytes":
      return ["x", Buffer.from(value as Uint8Array).toString("base64")];
    default:
      throw new Error(`${field.name}: unsupported field type ${field.type}`);
  }
}

export function scalarFields(model: ModelSpec, exclude: readonly string[] = []) {
  return model.fields.filter((f) => (f.kind === "scalar" || f.kind === "enum") && !exclude.includes(f.name));
}

export function canonicalRow(model: ModelSpec, row: Record<string, unknown>, exclude: readonly string[] = []) {
  return JSON.stringify(scalarFields(model, exclude).map((f) => [f.name, encodeValue(f, row[f.name])]));
}

function canonicalKey(model: ModelSpec, row: Record<string, unknown>) {
  const byName = new Map(model.fields.map((f) => [f.name, f]));
  return JSON.stringify(model.primaryKey.map((k) => encodeValue(byName.get(k)!, row[k])));
}

const codePointCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export type CanonicalTable = { model: string; rows: number; sha256: string; excludedFields: string[] };

export function canonicalTable(model: ModelSpec, rows: Array<Record<string, unknown>>, exclude: readonly string[] = []): CanonicalTable {
  const keyed = rows.map((r) => ({ key: canonicalKey(model, r), line: canonicalRow(model, r, exclude) }));
  keyed.sort((a, b) => codePointCompare(a.key, b.key));
  for (let i = 1; i < keyed.length; i += 1) {
    if (keyed[i].key === keyed[i - 1].key) throw new Error(`${model.name}: duplicate primary key ${keyed[i].key}`);
  }
  const hash = createHash("sha256");
  keyed.forEach((k, i) => hash.update(i === 0 ? k.line : `\n${k.line}`));
  return { model: model.name, rows: rows.length, sha256: hash.digest("hex"), excludedFields: [...exclude] };
}

/** Build a ModelSpec from a Prisma DMMF model (either client's DMMF). */
export function modelSpec(model: { name: string; fields: ReadonlyArray<{ name: string; kind: string; type: string; isId?: boolean }>; primaryKey?: { fields: readonly string[] } | null }): ModelSpec {
  const id = model.fields.filter((f) => f.isId).map((f) => f.name);
  const primaryKey = id.length ? id : [...(model.primaryKey?.fields ?? [])];
  if (!primaryKey.length) throw new Error(`${model.name} has no primary key`);
  return { name: model.name, fields: model.fields.map((f) => ({ name: f.name, kind: f.kind, type: f.type })), primaryKey };
}
