import type { LanguageModel } from "ai";
import type { Settings } from "../settings";
import { selectModel } from "../settings";

const zeroUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
function usageOf(
  provider: string,
  data: any,
): {
  inputTokens: {
    total: number;
    noCache: number;
    cacheRead: number;
    cacheWrite: number;
  };
  outputTokens: { total: number; text: number; reasoning: number };
} {
  if (provider === "anthropic") {
    const cacheRead = count(data.usage?.cache_read_input_tokens),
      cacheWrite = count(data.usage?.cache_creation_input_tokens),
      input = count(data.usage?.input_tokens),
      output = count(data.usage?.output_tokens);
    return {
      inputTokens: {
        total: input + cacheRead + cacheWrite,
        noCache: input,
        cacheRead,
        cacheWrite,
      },
      outputTokens: { total: output, text: output, reasoning: 0 },
    };
  }
  if (provider === "google") {
    const input = count(data.usageMetadata?.promptTokenCount),
      cacheRead = count(data.usageMetadata?.cachedContentTokenCount),
      output = count(data.usageMetadata?.candidatesTokenCount);
    return {
      inputTokens: {
        total: input,
        noCache: Math.max(0, input - cacheRead),
        cacheRead,
        cacheWrite: 0,
      },
      outputTokens: { total: output, text: output, reasoning: 0 },
    };
  }
  const input = count(data.usage?.prompt_tokens),
    output = count(data.usage?.completion_tokens),
    cacheRead = count(data.usage?.prompt_tokens_details?.cached_tokens);
  return {
    inputTokens: {
      total: input,
      noCache: Math.max(0, input - cacheRead),
      cacheRead,
      cacheWrite: 0,
    },
    outputTokens: { total: output, text: output, reasoning: 0 },
  };
}

/** Small non-streaming adapter for memory judges. It supports forced tool
 * calls because JSON response_format is unreliable through some gateways. */
export function createMemoryModel(s: Settings): LanguageModel {
  const c = s.providers[s.provider];
  return {
    specificationVersion: "v4",
    provider: s.provider,
    modelId: c.model,
    supportedUrls: {},
    async doGenerate(options) {
      const system = options.prompt
        .filter((m) => m.role === "system")
        .map((m) => (m as any).content)
        .join("\n");
      const user = options.prompt
        .filter((m) => m.role !== "system")
        .map((m) =>
          typeof m.content === "string"
            ? m.content
            : (m.content as any[])
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("\n"),
        )
        .join("\n");
      const tools = (options.tools ?? []).filter(
        (t): t is any => t.type === "function",
      );
      const forced =
        options.toolChoice?.type === "tool"
          ? options.toolChoice.toolName
          : undefined;
      const required = options.toolChoice?.type === "required";
      const schema =
        options.responseFormat?.type === "json"
          ? options.responseFormat.schema
          : undefined;
      const instructions =
        system +
        (tools.length
          ? ""
          : "\nReturn only valid JSON, no code fences." +
            (schema
              ? "\nRequired JSON schema: " + JSON.stringify(schema)
              : ""));
      let url = "",
        body: any,
        headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
      const base = c.baseURL.replace(/\/$/, "");
      if (s.provider === "anthropic") {
        url = `${base || "https://api.anthropic.com/v1"}/messages`;
        Object.assign(headers, {
          "x-api-key": c.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        });
        body = {
          model: c.model,
          max_tokens: 4096,
          system: instructions,
          messages: [{ role: "user", content: user }],
          ...(tools.length
            ? {
                tools: tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  input_schema: t.inputSchema,
                })),
                ...(forced
                  ? { tool_choice: { type: "tool", name: forced } }
                  : required
                    ? { tool_choice: { type: "any" } }
                    : {}),
              }
            : {}),
        };
      } else if (s.provider === "google") {
        url = `${base || "https://generativelanguage.googleapis.com/v1beta"}/models/${encodeURIComponent(c.model)}:generateContent`;
        headers["x-goog-api-key"] = c.apiKey;
        body = {
          systemInstruction: { parts: [{ text: instructions }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { responseMimeType: "application/json" },
          ...(tools.length
            ? {
                tools: [
                  {
                    functionDeclarations: tools.map((t) => ({
                      name: t.name,
                      description: t.description,
                      parameters: t.inputSchema,
                    })),
                  },
                ],
                ...(forced
                  ? {
                      toolConfig: {
                        functionCallingConfig: {
                          mode: "ANY",
                          allowedFunctionNames: [forced],
                        },
                      },
                    }
                  : {}),
              }
            : {}),
        };
      } else {
        url = `${base || "https://api.openai.com/v1"}/chat/completions`;
        if (c.apiKey) headers.Authorization = `Bearer ${c.apiKey}`;
        body = {
          model: c.model,
          messages: [
            { role: "system", content: instructions },
            { role: "user", content: user },
          ],
          ...(tools.length
            ? {
                tools: tools.map((t) => ({
                  type: "function",
                  function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.inputSchema,
                  },
                })),
                ...(forced
                  ? {
                      tool_choice: {
                        type: "function",
                        function: { name: forced },
                      },
                    }
                  : required
                    ? { tool_choice: "required" }
                    : {}),
              }
            : { response_format: { type: "json_object" } }),
        };
      }
      const response = await globalThis.fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options.abortSignal,
      });
      if (!response.ok)
        throw new Error(
          `Memory model failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
        );
      const data = await response.json();
      const content: any[] = [];
      if (s.provider === "anthropic") {
        const blocks = data.content ?? [];
        for (const block of blocks) {
          if (block.type === "tool_use")
            content.push({
              type: "tool-call",
              toolCallId: block.id,
              toolName: block.name,
              input: JSON.stringify(block.input ?? {}),
            });
          else if (block.type === "text" && typeof block.text === "string")
            content.push({ type: "text", text: block.text });
        }
      } else if (s.provider === "google") {
        const parts = data.candidates?.[0]?.content?.parts ?? [];
        for (const [index, part] of parts.entries()) {
          if (part.functionCall)
            content.push({
              type: "tool-call",
              toolCallId: `call-${index}`,
              toolName: part.functionCall.name,
              input: JSON.stringify(part.functionCall.args ?? {}),
            });
          else if (typeof part.text === "string")
            content.push({ type: "text", text: part.text });
        }
      } else {
        const message = data.choices?.[0]?.message;
        for (const call of message?.tool_calls ?? []) {
          if (!call?.function?.name) continue;
          content.push({
            type: "tool-call",
            toolCallId: call.id ?? `call-${content.length}`,
            toolName: call.function.name,
            input:
              typeof call.function.arguments === "string"
                ? call.function.arguments
                : JSON.stringify(call.function.arguments ?? {}),
          });
        }
        if (typeof message?.content === "string" && message.content)
          content.push({ type: "text", text: message.content });
      }
      if (!content.length) throw new Error("Memory model returned no text.");
      return {
        content,
        finishReason: {
          unified: content.some((part) => part.type === "tool-call")
            ? ("tool-calls" as const)
            : ("stop" as const),
          raw: "stop",
        },
        usage:
          data.usage || data.usageMetadata
            ? usageOf(s.provider, data)
            : zeroUsage,
        warnings: [],
      };
    },
    async doStream() {
      throw new Error("Memory models do not stream.");
    },
  };
}
export function memoryModels(s: Settings) {
  const configs: Settings[] = [];
  const c = s.providers[s.provider];
  if (
    ["anthropic", "openai-compatible"].includes(s.provider) &&
    c.model !== "claude-haiku-5-5" &&
    (!c.models || c.models.includes("claude-haiku-5-5"))
  )
    configs.push(selectModel(s, s.provider, "claude-haiku-5-5"));
  configs.push(s);
  return configs.map(createMemoryModel);
}
