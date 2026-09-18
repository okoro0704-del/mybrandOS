export type AiInvokeInput = {
  actionType: string;
  instruction?: string;
  selectedText?: string;
  projectTitle: string;
  projectType: string;
  projectDescription?: string;
  blockType?: string;
  blockContent?: string;
  actorToken?: string;
  entitySlug?: string;
};

export type AiInvokeResult = {
  available: true;
  provider: string;
  text: string;
  model?: string;
};

export type AiUnavailable = {
  available: false;
  provider: string;
  detail: string;
};

export type AiHealth = {
  available: boolean;
  provider: string;
  detail: string;
};

export interface IAiProvider {
  readonly kind: "ai-provider";
  health(): AiHealth;
  invoke(input: AiInvokeInput): Promise<AiInvokeResult | AiUnavailable>;
}

export class UnboundAiProvider implements IAiProvider {
  readonly kind = "ai-provider" as const;

  constructor(
    private readonly detail = "No AI provider configured. Set DIGI_AI_URL and DIGI_AI_CALLER_KEY.",
  ) {}

  health(): AiHealth {
    return { available: false, provider: "unbound", detail: this.detail };
  }

  async invoke(): Promise<AiUnavailable> {
    const health = this.health();
    return { available: false, provider: health.provider, detail: health.detail };
  }
}

/** Canonical studio path: mybrandOS → Digi AI → provider router. */
export class RemoteDigiAiProvider implements IAiProvider {
  readonly kind = "ai-provider" as const;

  constructor(
    private readonly url: string,
    private readonly callerId: string,
    private readonly callerKey: string,
  ) {}

  health(): AiHealth {
    return {
      available: true,
      provider: "digi-ai",
      detail: "Digi AI bound",
    };
  }

  async invoke(input: AiInvokeInput): Promise<AiInvokeResult | AiUnavailable> {
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-digi-ai-caller": this.callerId,
        "x-digi-ai-caller-key": this.callerKey,
      };
      if (input.actorToken) headers.authorization = `Bearer ${input.actorToken}`;
      const res = await fetch(`${this.url.replace(/\/$/, "")}/v1/ask`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: [
            input.instruction || `Perform studio action: ${input.actionType}`,
            input.selectedText ? `Selected text:\n${input.selectedText}` : "",
            !input.selectedText && input.blockContent ? `Current block:\n${input.blockContent}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
          mode: "draft",
          sources: ["supplied"],
          entity: input.entitySlug ? { slug: input.entitySlug, appId: "mybrandos" } : { appId: "mybrandos" },
          suppliedContext: {
            text: input.selectedText || input.blockContent || input.projectTitle,
            label: "mybrandos-studio",
          },
          draft: {
            actionType: input.actionType,
            projectTitle: input.projectTitle,
            projectType: input.projectType,
            projectDescription: input.projectDescription,
            blockType: input.blockType,
          },
        }),
      });
      const raw = (await res.json()) as {
        ok?: boolean;
        answer?: string;
        message?: string;
        execution?: { model?: string };
      };
      if (!res.ok || !raw.ok || !raw.answer) {
        return {
          available: false,
          provider: "digi-ai",
          detail: raw.message || "Digi AI did not return generated text.",
        };
      }
      return {
        available: true,
        provider: "digi-ai",
        text: raw.answer,
        model: raw.execution?.model,
      };
    } catch {
      return { available: false, provider: "digi-ai", detail: "Digi AI is unreachable." };
    }
  }
}

/** Test-only provider. Never used by production wiring. */
export class TestAiProvider implements IAiProvider {
  readonly kind = "ai-provider" as const;

  health(): AiHealth {
    return { available: true, provider: "test", detail: "Test provider" };
  }

  async invoke(input: AiInvokeInput): Promise<AiInvokeResult> {
    const seed = input.selectedText || input.blockContent || input.projectTitle;
    return {
      available: true,
      provider: "test",
      text: `[${input.actionType}] ${seed}`.trim(),
    };
  }
}

export function createAiProvider(config: {
  provider: string;
  apiKey?: string;
  model?: string;
  digiAiUrl?: string;
  digiAiCallerId?: string;
  digiAiCallerKey?: string;
}): IAiProvider {
  if (config.digiAiUrl && config.digiAiCallerKey) {
    return new RemoteDigiAiProvider(
      config.digiAiUrl,
      config.digiAiCallerId || "mybrandos",
      config.digiAiCallerKey,
    );
  }
  const name = config.provider.toLowerCase();
  if (name === "test") return new TestAiProvider();
  if (name === "openai") {
    return new UnboundAiProvider("Canonical AI is Digi AI. Configure DIGI_AI_URL and DIGI_AI_CALLER_KEY.");
  }
  return new UnboundAiProvider();
}
