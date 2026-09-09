export type AiInvokeInput = {
  actionType: string;
  instruction?: string;
  selectedText?: string;
  projectTitle: string;
  projectType: string;
  projectDescription?: string;
  blockType?: string;
  blockContent?: string;
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
    private readonly detail = "No AI provider configured. Set AI_PROVIDER and the matching API key.",
  ) {}

  health(): AiHealth {
    return { available: false, provider: "unbound", detail: this.detail };
  }

  async invoke(): Promise<AiUnavailable> {
    const health = this.health();
    return { available: false, provider: health.provider, detail: health.detail };
  }
}

export class OpenAiProvider implements IAiProvider {
  readonly kind = "ai-provider" as const;

  constructor(
    private readonly apiKey: string,
    private readonly model = "gpt-4o-mini",
  ) {}

  health(): AiHealth {
    return {
      available: true,
      provider: "openai",
      detail: `OpenAI bound (${this.model})`,
    };
  }

  async invoke(input: AiInvokeInput): Promise<AiInvokeResult | AiUnavailable> {
    const system = [
      "You are a creation assistant inside mybrandOS.",
      "Operate on the current project and selected content.",
      "Return only the resulting text the user can edit. Do not wrap in markdown fences.",
      `Project: ${input.projectTitle} (${input.projectType})`,
      input.projectDescription ? `Description: ${input.projectDescription}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const user = [
      `Action: ${input.actionType}`,
      input.instruction ? `Instruction: ${input.instruction}` : "",
      input.blockType ? `Block type: ${input.blockType}` : "",
      input.selectedText ? `Selected content:\n${input.selectedText}` : "",
      !input.selectedText && input.blockContent ? `Current block:\n${input.blockContent}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.7,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) {
        return {
          available: false,
          provider: "openai",
          detail: `OpenAI request failed (${res.status}).`,
        };
      }
      const raw = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = raw.choices?.[0]?.message?.content?.trim();
      if (!text) {
        return { available: false, provider: "openai", detail: "OpenAI returned an empty response." };
      }
      return { available: true, provider: "openai", text, model: this.model };
    } catch {
      return { available: false, provider: "openai", detail: "OpenAI is unreachable." };
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
}): IAiProvider {
  const name = config.provider.toLowerCase();
  if (name === "openai" && config.apiKey) {
    return new OpenAiProvider(config.apiKey, config.model);
  }
  if (name === "openai" && !config.apiKey) {
    return new UnboundAiProvider("AI_PROVIDER=openai but OPENAI_API_KEY is missing.");
  }
  if (name === "test") {
    return new TestAiProvider();
  }
  return new UnboundAiProvider();
}
