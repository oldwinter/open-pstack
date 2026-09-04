import type {
  LaneTarget,
  NormalizedUsage,
  ParsedOutput,
} from "./types.ts";
import {
  concreteModelMatchesRollingAlias,
  isRollingClaudeAlias,
} from "./model-aliases.ts";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizedUsage(value: unknown): NormalizedUsage | null {
  const usage = object(value);
  if (usage === null) return null;
  const result: NormalizedUsage = {
    inputTokens: finiteNumber(usage.input_tokens),
    cachedInputTokens: finiteNumber(
      usage.cached_input_tokens ?? usage.cache_read_input_tokens
    ),
    cacheCreationInputTokens: finiteNumber(
      usage.cache_creation_input_tokens ?? usage.cache_write_input_tokens
    ),
    outputTokens: finiteNumber(usage.output_tokens),
    reasoningTokens: finiteNumber(
      usage.reasoning_tokens ?? usage.reasoning_output_tokens
    ),
    totalTokens: finiteNumber(usage.total_tokens),
  };
  return Object.values(result).some((entry) => entry !== undefined)
    ? result
    : null;
}

function normalizedPiUsage(value: unknown): NormalizedUsage | null {
  const usage = object(value);
  if (usage === null) return null;
  const result: NormalizedUsage = {
    inputTokens: finiteNumber(usage.input),
    cachedInputTokens: finiteNumber(usage.cacheRead),
    cacheCreationInputTokens: finiteNumber(usage.cacheWrite),
    outputTokens: finiteNumber(usage.output),
    totalTokens: finiteNumber(usage.totalTokens),
  };
  return Object.values(result).some((entry) => entry !== undefined)
    ? result
    : null;
}

function modelFromUsage(value: unknown, target: LaneTarget): string | null {
  const usage = object(value);
  if (usage === null) return null;
  const models = Object.keys(usage);
  return models.find((model) => reportedModelMatches(target, model))
    ?? models[0]
    ?? null;
}

function parseClaude(stdout: string, target: LaneTarget): ParsedOutput {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error("claude did not emit valid JSON");
  }
  const value = object(raw);
  if (value === null) throw new Error("claude emitted a non-object result");

  const text = nullableString(value.result);
  if (text === null) throw new Error("claude result did not contain final text");
  if (value.is_error === true) throw new Error("claude reported an error result");

  return {
    text,
    reportedProvider: null,
    reportedModel: modelFromUsage(value.modelUsage, target),
    sessionId: nullableString(value.session_id ?? value.sessionId),
    usage: normalizedUsage(value.usage),
    costUsd: finiteNumber(value.total_cost_usd) ?? null,
  };
}

function parseGrok(stdout: string, target: LaneTarget): ParsedOutput {
  let result: JsonObject | null = null;
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error("grok emitted a non-JSON event");
    }
    const event = object(raw);
    if (event?.type === "result") result = event;
  }

  if (result === null) throw new Error("grok result did not contain a terminal event");
  if (result.is_error === true || result.subtype !== "success") {
    throw new Error("grok reported an error result");
  }
  const text = nullableString(result.result);
  if (text === null) throw new Error("grok result did not contain final text");

  return {
    text,
    reportedProvider: null,
    reportedModel: modelFromUsage(result.modelUsage, target),
    sessionId: nullableString(result.session_id),
    usage: normalizedUsage(result.usage),
    costUsd: finiteNumber(result.total_cost_usd) ?? null,
  };
}

function parseCodex(stdout: string): ParsedOutput {
  let text: string | null = null;
  let usage: NormalizedUsage | null = null;
  let sessionId: string | null = null;

  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error("codex emitted a non-JSON event");
    }
    const event = object(raw);
    if (event === null) continue;
    if (event.type === "thread.started") {
      sessionId = nullableString(event.thread_id) ?? sessionId;
    }
    if (event.type === "item.completed") {
      const item = object(event.item);
      if (item?.type === "agent_message") {
        text = nullableString(item.text) ?? text;
      }
    }
    if (event.type === "turn.completed") {
      usage = normalizedUsage(event.usage) ?? usage;
    }
    if (event.type === "turn.failed") {
      const error = object(event.error);
      throw new Error(nullableString(error?.message) ?? "codex reported a failed turn");
    }
  }

  if (text === null) throw new Error("codex result did not contain a final agent message");
  return {
    text,
    reportedProvider: null,
    reportedModel: null,
    sessionId,
    usage,
    costUsd: null,
  };
}

function piText(message: JsonObject): string | null {
  if (!Array.isArray(message.content)) return null;
  const text = message.content.flatMap((entry) => {
    const content = object(entry);
    return content?.type === "text" && typeof content.text === "string"
      ? [content.text]
      : [];
  }).join("");
  return text.length > 0 ? text : null;
}

function parsePi(stdout: string, target: LaneTarget): ParsedOutput {
  let sessionId: string | null = null;
  let finalMessage: JsonObject | null = null;
  let finalMessageIndex = -1;
  let agentEndIndex = -1;
  let settledIndex = -1;

  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  for (const [index, line] of lines.entries()) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error("pi emitted a non-JSON event");
    }
    const event = object(raw);
    if (event === null || typeof event.type !== "string") {
      throw new Error("pi emitted a malformed event");
    }
    if (event.type === "session") {
      sessionId = nullableString(event.id) ?? sessionId;
    }
    if (event.type === "auto_retry_start") {
      throw new Error("pi attempted an automatic retry");
    }
    if (event.type === "message_end") {
      const message = object(event.message);
      if (message?.role !== "assistant") continue;
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        throw new Error(`pi reported an ${message.stopReason} assistant response`);
      }
      finalMessage = message;
      finalMessageIndex = index;
    }
    if (event.type === "agent_end") {
      if (event.willRetry !== false) {
        throw new Error("pi ended an agent run with retry pending");
      }
      agentEndIndex = index;
    }
    if (event.type === "agent_settled") settledIndex = index;
  }

  if (sessionId === null) throw new Error("pi result did not contain a session event");
  if (finalMessage === null) {
    throw new Error("pi result did not contain a final assistant message");
  }
  if (agentEndIndex <= finalMessageIndex || settledIndex <= agentEndIndex) {
    throw new Error("pi result did not contain a settled terminal sequence");
  }
  const reportedProvider = nullableString(finalMessage.provider);
  const reportedModel = nullableString(finalMessage.model);
  if (reportedProvider !== target.apiProvider) {
    throw new Error(`pi did not report requested provider ${target.apiProvider}`);
  }
  if (reportedModel !== target.model) {
    throw new Error(`pi did not report requested model ${target.model}`);
  }
  const text = piText(finalMessage);
  if (text === null) throw new Error("pi result did not contain final text");
  const usageValue = object(finalMessage.usage);
  const cost = object(usageValue?.cost);

  return {
    text,
    reportedProvider,
    reportedModel,
    sessionId,
    usage: normalizedPiUsage(usageValue),
    costUsd: finiteNumber(cost?.total) ?? null,
  };
}

export function parseProviderOutput(
  target: LaneTarget,
  stdout: string,
  _stderr: string
): ParsedOutput {
  switch (target.harness) {
    case "claude":
      return parseClaude(stdout, target);
    case "codex":
      return parseCodex(stdout);
    case "grok":
      return parseGrok(stdout, target);
    case "pi":
      return parsePi(stdout, target);
  }
}

export function reportedModelMatches(
  target: LaneTarget,
  reported: string | null
): boolean {
  if (reported === null) return false;
  if (target.harness === "claude" && isRollingClaudeAlias(target.model)) {
    return concreteModelMatchesRollingAlias(target.model, reported);
  }
  if (target.harness === "pi") return reported === target.model;
  return reported === target.model || reported.startsWith(`${target.model}-`);
}
