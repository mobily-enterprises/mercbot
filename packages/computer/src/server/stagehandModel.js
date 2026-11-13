import { modelSettings } from "@local/account/model";

const asArray = (content) => (Array.isArray(content) ? content : [content]);

function toChatMessages(params) {
  const system = [params.systemPrompt || ""];
  if (params.responseFormat) {
    system.push(`Reply with a single JSON object that matches this JSON schema:\n${JSON.stringify(params.responseFormat.schema)}`);
  }
  const messages = [];
  if (system.join("").trim()) messages.push({ role: "system", content: system.filter(Boolean).join("\n\n") });
  for (const message of params.messages) {
    const blocks = asArray(message.content);
    if (message.role === "assistant") {
      const text = blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      const calls = blocks.filter((block) => block.type === "tool_use").map((block) => ({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input || {}) }
      }));
      messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    for (const block of blocks.filter((entry) => entry.type === "tool_result")) {
      const text = asArray(block.content || []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
      messages.push({ role: "tool", tool_call_id: block.toolUseId, content: text || JSON.stringify(block.structuredContent || {}) });
    }
    const parts = blocks.flatMap((block) => {
      if (block.type === "text") return [{ type: "text", text: block.text }];
      if (block.type === "image") return [{ type: "image_url", image_url: { url: `data:${block.mimeType};base64,${block.data}` } }];
      return [];
    });
    if (parts.length) {
      const content = parts.every((part) => part.type === "text") ? parts.map((part) => part.text).join("\n") : parts;
      messages.push({ role: "user", content });
    }
  }
  return messages;
}

const STOP_REASONS = { tool_calls: "toolUse", stop: "endTurn", length: "maxTokens" };

/**
 * The client model Stagehand drives the bot's browser with, on the premium AI (WORK.browser, D-59, D-72).
 *
 * Stagehand v4 has no option for our provider, so the model goes in through its client model
 * (docs/architecture.md §3.4, D-45): messages become OpenAI-style chat at the provider, tools pass
 * through, and responseFormat asks for a JSON object matching the schema.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function createStagehandModel(env) {
  const settings = modelSettings(env, "browser");
  const { apiKey, model, fetch: send } = settings;
  async function generate(params) {
    const body = {
      model,
      messages: toChatMessages(params),
      thinking: { type: "disabled" },
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params.stopSequences?.length ? { stop: params.stopSequences } : {}),
      ...(params.responseFormat ? { response_format: { type: "json_object" } } : {})
    };
    if (params.tools?.length) {
      body.tools = params.tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description || "", parameters: tool.inputSchema }
      }));
      if (params.toolChoice?.mode) body.tool_choice = params.toolChoice.mode;
    }
    const response = await send(`${settings.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`${settings.name} request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    const data = await response.json();
    const choice = data.choices?.[0] || {};
    const text = String(choice.message?.content || "");
    const content = [
      ...(text ? [{ type: "text", text }] : []),
      ...(choice.message?.tool_calls || []).map((call) => ({
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input: JSON.parse(call.function.arguments || "{}")
      }))
    ];
    const usage = data.usage
      ? {
          inputTokens: data.usage.prompt_tokens || 0,
          outputTokens: data.usage.completion_tokens || 0,
          totalTokens: data.usage.total_tokens || 0,
          cachedInputTokens: data.usage.prompt_cache_hit_tokens || 0
        }
      : undefined;
    const result = {
      role: "assistant",
      content: content.length ? content : [{ type: "text", text: "" }],
      stopReason: STOP_REASONS[choice.finish_reason] || choice.finish_reason,
      usage
    };
    if (params.responseFormat) {
      const structuredContent = JSON.parse(text.replace(/^```(json)?|```$/gu, "").trim() || "{}");
      return { ...result, outputFormat: "json_schema", structuredContent };
    }
    return { ...result, outputFormat: "text" };
  }

  return Object.freeze({ generate });
}
