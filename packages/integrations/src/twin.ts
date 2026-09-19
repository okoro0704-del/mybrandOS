import type { TwinBrief, TwinOwnerContext } from "@mybrandos/shared";

export type TwinBriefRequest = {
  url: string;
  callerId: string;
  callerKey: string;
  actorToken?: string;
  ownerContext: TwinOwnerContext;
};

export type TwinBriefCall =
  | { ok: true; brief: TwinBrief }
  | { ok: false; status: number; error: string; message: string };

export async function requestTwinBrief(input: TwinBriefRequest): Promise<TwinBriefCall> {
  if (!input.url || !input.callerKey) {
    return { ok: false, status: 503, error: "digi_ai_unbound", message: "Digi AI is not configured." };
  }
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-digi-ai-caller": input.callerId || "mybrandos",
      "x-digi-ai-caller-key": input.callerKey,
    };
    if (input.actorToken) headers.authorization = `Bearer ${input.actorToken}`;
    const res = await fetch(`${input.url.replace(/\/$/, "")}/v1/twin/brief`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ownerContext: input.ownerContext,
        entity: { slug: input.ownerContext.entitySlug, appId: "mybrandos" },
      }),
    });
    const raw = (await res.json()) as TwinBrief & { error?: string; message?: string; ok?: boolean };
    if (!res.ok || !raw.ok) {
      return {
        ok: false,
        status: res.status,
        error: raw.error || "twin_brief_failed",
        message: raw.message || "Digi AI could not complete that briefing.",
      };
    }
    return { ok: true, brief: raw };
  } catch {
    return { ok: false, status: 502, error: "digi_ai_unreachable", message: "Digi AI is unreachable." };
  }
}
