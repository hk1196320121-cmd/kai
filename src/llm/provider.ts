export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  choices: { message: { content: string } }[];
}

export class LLMProvider {
  private config: LLMConfig;

  constructor(config?: Partial<LLMConfig>) {
    this.config = {
      apiKey: config?.apiKey ?? process.env.LLM_API_KEY ?? "",
      baseUrl:
        config?.baseUrl ??
        process.env.LLM_BASE_URL ??
        "http://localhost:11434/v1",
      model: config?.model ?? process.env.LLM_MODEL ?? "gpt-4o-mini",
    };
  }

  getConfig(): LLMConfig {
    return { ...this.config };
  }

  buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  buildRequestBody(
    prompt: string,
    systemPrompt: string,
    options?: { max_tokens?: number },
  ): Record<string, unknown> {
    return {
      model: this.config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ] as ChatMessage[],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: options?.max_tokens ?? 2048,
    };
  }

  async call(
    prompt: string,
    systemPrompt: string,
    retries = 1,
    options?: { max_tokens?: number },
  ): Promise<Record<string, unknown>> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const body = this.buildRequestBody(prompt, systemPrompt, options);

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: this.buildHeaders(),
          body: JSON.stringify(body),
        });

        if (response.status === 429) {
          const delay = 2 ** attempt * 1000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        if (!response.ok) {
          throw new Error(`LLM API error: ${response.status}`);
        }

        const data = (await response.json()) as ChatResponse;
        return await this.parseResponse(data);
      } catch (error) {
        if (attempt === retries) throw error;
        if (
          error instanceof Error &&
          error.message.startsWith("LLM API error:")
        ) {
          const status = parseInt(
            error.message.replace("LLM API error: ", ""),
            10,
          );
          if (status !== 429 && status < 500) throw error;
        }
        const delay = 2 ** attempt * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw new Error("LLM call failed after retries");
  }

  async parseResponse(response: {
    choices: { message: { content: string } }[];
  }): Promise<Record<string, unknown>> {
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No content in LLM response");
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid JSON in LLM response");
    }
  }

  validateWithSchema(
    obj: Record<string, unknown>,
    requiredFields: string[],
  ): void {
    for (const field of requiredFields) {
      if (!(field in obj)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
  }
}
