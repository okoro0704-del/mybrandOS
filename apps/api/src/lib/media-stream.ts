import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DataZoneByteStream, IDataZoneProvider } from "@mybrandos/integrations";
import { notFound, unavailable } from "./errors.js";

/**
 * Public media delivery by HTTP byte range, without holding the object in memory.
 *
 * The client's Range is forwarded to DataZone. When DataZone answers 206 the slice is piped
 * straight through. When it answers 200 (a store without range support), the body is still
 * streamed: bytes before the range start are discarded as they pass, and the upstream request is
 * cancelled as soon as the range end has been sent. Memory stays bounded by one chunk either way;
 * only the upstream transfer differs (see `MediaStreamStats`).
 */

export type ParsedRange =
  | { kind: "none" }
  | { kind: "range"; start: number; end: number }
  | { kind: "unsatisfiable" };

/**
 * RFC 9110 single byte ranges: "bytes=a-b", "bytes=a-", "bytes=-n". Anything else (several ranges,
 * other units, malformed) is ignored and the whole representation is served, as the RFC allows.
 */
export function parseRange(header: string | undefined, total: number): ParsedRange {
  if (!header) return { kind: "none" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return { kind: "none" };
  if (!m[1]) {
    // Suffix range: the last n bytes.
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n) || n <= 0 || total <= 0) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, total - n), end: total - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : total - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { kind: "unsatisfiable" };
  if (start >= total) return { kind: "unsatisfiable" };
  if (end < start) return { kind: "none" };
  return { kind: "range", start, end: Math.min(end, total - 1) };
}

/** Parse "bytes a-b/total" from an upstream Content-Range. */
function upstreamContentRange(value: string | undefined): { start: number; end: number; total: number } | null {
  const m = value ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim()) : null;
  return m ? { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) } : null;
}

export type MediaStreamStats = {
  /** Bytes received from DataZone for this response. */
  upstreamBytes: number;
  /** Bytes sent to the client. */
  sentBytes: number;
  /** Whether DataZone itself served the range (206). */
  upstreamRanged: boolean;
};

/**
 * Stream `[skip, skip + take)` of an upstream body, then cancel the upstream. Pull-based, so a
 * slow client slows the upstream read (backpressure); destroying the result cancels the upstream.
 */
export function windowStream(
  body: ReadableStream<Uint8Array>,
  skip: number,
  take: number,
  stats: MediaStreamStats,
  onDone: () => void,
): Readable {
  const reader = body.getReader();
  let skipped = 0;
  let sent = 0;
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    await reader.cancel().catch(() => undefined);
    onDone();
  };
  return new Readable({
    async read() {
      try {
        while (sent < take) {
          const { value, done } = await reader.read();
          if (done) break;
          stats.upstreamBytes += value.byteLength;
          let chunk = value;
          if (skipped < skip) {
            const drop = Math.min(skip - skipped, chunk.byteLength);
            skipped += drop;
            chunk = chunk.subarray(drop);
            if (!chunk.byteLength) continue;
          }
          const keep = Math.min(chunk.byteLength, take - sent);
          sent += keep;
          stats.sentBytes += keep;
          this.push(keep === chunk.byteLength ? chunk : chunk.subarray(0, keep));
          return;
        }
        await finish();
        this.push(null);
      } catch (err) {
        await finish();
        this.destroy(err as Error);
      }
    },
    destroy(err, callback) {
      void finish().then(() => callback(err));
    },
  });
}

export async function sendMediaStream(
  req: FastifyRequest,
  reply: FastifyReply,
  input: {
    dataZone: IDataZoneProvider;
    dataZoneId: string;
    /** Size recorded at upload, when known. */
    sizeBytes?: number | null;
    mimeType?: string | null;
    filename?: string | null;
    /** Test hook: receives transfer stats when the response ends. */
    onStats?: (stats: MediaStreamStats) => void;
  },
): Promise<FastifyReply> {
  const requested = typeof req.headers.range === "string" ? req.headers.range : undefined;
  const known = typeof input.sizeBytes === "number" && input.sizeBytes > 0 ? input.sizeBytes : null;
  // Without a recorded size the range is resolved once the upstream reports the length.
  let range: ParsedRange = known ? parseRange(requested, known) : { kind: "none" };
  if (range.kind === "unsatisfiable" && known) {
    return reply.code(416).header("content-range", `bytes */${known}`).header("accept-ranges", "bytes").send();
  }

  // Abort the upstream read if the client goes away.
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.raw.once("close", abort);

  const upstreamRange =
    range.kind === "range" ? `bytes=${range.start}-${range.end}` : !known && requested ? requested : undefined;
  let upstream: DataZoneByteStream | null;
  try {
    upstream = await input.dataZone.openBytes(input.dataZoneId, { range: upstreamRange, signal: controller.signal });
  } catch (err) {
    req.raw.off("close", abort);
    if (controller.signal.aborted) return reply;
    throw unavailable("DATAZONE_UNAVAILABLE", err instanceof Error ? err.message : "File storage is currently unavailable.");
  }
  if (!upstream) {
    req.raw.off("close", abort);
    throw notFound("This work is not available.");
  }

  const stats: MediaStreamStats = { upstreamBytes: 0, sentBytes: 0, upstreamRanged: upstream.status === 206 };
  const done = () => {
    req.raw.off("close", abort);
    input.onStats?.(stats);
  };
  const contentType = upstream.contentType || input.mimeType || "application/octet-stream";
  reply
    .header("accept-ranges", "bytes")
    .header("content-type", contentType)
    .header("cache-control", "public, max-age=86400")
    .header("content-disposition", `inline; filename="${(input.filename || "media").replace(/["\r\n]/g, "")}"`);

  if (upstream.status === 206) {
    const served = upstreamContentRange(upstream.contentRange);
    if (!served) {
      await upstream.body.cancel().catch(() => undefined);
      done();
      throw unavailable("DATAZONE_UNAVAILABLE", "File storage returned an invalid range.");
    }
    const length = served.end - served.start + 1;
    return reply
      .code(206)
      .header("content-range", `bytes ${served.start}-${served.end}/${served.total}`)
      .header("content-length", String(length))
      .send(windowStream(upstream.body, 0, length, stats, done));
  }

  // Store without range support: it sent the whole object (200).
  const total = known ?? upstream.contentLength ?? null;
  if (!known && total) range = parseRange(requested, total);
  if (range.kind === "unsatisfiable" && total) {
    await upstream.body.cancel().catch(() => undefined);
    done();
    return reply.code(416).header("content-range", `bytes */${total}`).send();
  }
  if (range.kind === "range" && total) {
    const length = range.end - range.start + 1;
    return reply
      .code(206)
      .header("content-range", `bytes ${range.start}-${range.end}/${total}`)
      .header("content-length", String(length))
      .send(windowStream(upstream.body, range.start, length, stats, done));
  }
  if (total) reply.header("content-length", String(total));
  return reply.code(200).send(windowStream(upstream.body, 0, total ?? Number.MAX_SAFE_INTEGER, stats, done));
}
