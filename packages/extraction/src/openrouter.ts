import OpenAI from "openai";
import { z } from "zod";
import type { ExtractionProvider, ExtractionResult } from "./types.js";
import { buildUserPrompt, responseSchema, SYSTEM_PROMPT } from "./prompt.js";

const ResponseShape = z.object({
  fields: z.array(
    z.object({
      field: z.string(),
      value: z.string().nullable(),
      evidence: z.string().nullable(),
      gap_reason: z.string().nullable(),
    }),
  ),
});

export class ExtractionError extends Error {
  constructor(
    message: string,
    /** kept so a failed run is still debuggable */
    readonly details: { prompt: string; rawResponse: unknown },
  ) {
    super(message);
  }
}

let catalog: Promise<Map<string, Set<string>>> | undefined;

/** Model -> supported request parameters, from OpenRouter's public catalog (fetched once per process). */
async function supportedParameters(model: string): Promise<Set<string>> {
  catalog ??= fetch("https://openrouter.ai/api/v1/models")
    .then((r) => r.json() as Promise<{ data: { id: string; supported_parameters?: string[] }[] }>)
    .then((j) => new Map(j.data.map((m) => [m.id, new Set(m.supported_parameters ?? [])])))
    .catch(() => {
      catalog = undefined; // retry next time; meanwhile assume nothing optional is supported
      return new Map<string, Set<string>>();
    });
  return (await catalog).get(model) ?? new Set();
}

export interface OpenRouterOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * OpenRouter via its OpenAI-compatible API, using strict JSON-schema output.
 * `provider.require_parameters` makes OpenRouter route only to upstream
 * providers that honour response_format, so the schema is actually enforced.
 */
export function createOpenRouterProvider(opts: OpenRouterOptions = {}): ExtractionProvider {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const model = opts.model ?? process.env.EXTRACTION_MODEL ?? "anthropic/claude-sonnet-5.5";
  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: opts.timeoutMs ?? 60_000,
    maxRetries: 2,
    defaultHeaders: { "X-Title": "document-review-extraction" },
  });

  return {
    model,
    async extract({ documentType, fields, text }): Promise<ExtractionResult> {
      const user = buildUserPrompt(documentType, fields, text);
      const prompt = `SYSTEM:\n${SYSTEM_PROMPT}\n\nUSER:\n${user}`;
      const started = Date.now();
      // Reasoning models (current Claude/GPT) reject `temperature`; with
      // require_parameters an unsupported param excludes every endpoint (404).
      const supportsTemperature = (await supportedParameters(model)).has("temperature");
      const body = {
        model,
        ...(supportsTemperature ? { temperature: 0 } : {}),
        messages: [
          { role: "system" as const, content: SYSTEM_PROMPT },
          { role: "user" as const, content: user },
        ],
        response_format: {
          type: "json_schema" as const,
          json_schema: { name: "extraction", strict: true, schema: responseSchema(fields) },
        },
        // OpenRouter extensions
        provider: { require_parameters: true },
        usage: { include: true },
      };
      const completion = await client.chat.completions.create(body as OpenAI.ChatCompletionCreateParamsNonStreaming);
      const latencyMs = Date.now() - started;
      const content = completion.choices[0]?.message?.content ?? "";

      let parsed: z.infer<typeof ResponseShape>;
      try {
        parsed = ResponseShape.parse(JSON.parse(content));
      } catch (err) {
        throw new ExtractionError(`model returned malformed output: ${(err as Error).message}`, {
          prompt,
          rawResponse: completion,
        });
      }
      const usage = completion.usage as (OpenAI.CompletionUsage & { cost?: number }) | undefined;
      return {
        model: completion.model ?? model,
        prompt,
        rawResponse: completion,
        fields: parsed.fields,
        usage: {
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
          costUsd: usage?.cost ?? null,
          latencyMs,
        },
      };
    },
  };
}
