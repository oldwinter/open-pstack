import { describe, expect, it } from "bun:test";
import { parseProviderOutput, reportedModelMatches } from "./parse-output.ts";
import type { LaneTarget } from "./types.ts";

const claudeTarget: LaneTarget = {
  harness: "claude",
  apiProvider: "anthropic",
  model: "fable",
  effort: "max",
};
const codexTarget: LaneTarget = {
  harness: "codex",
  apiProvider: "openai",
  model: "gpt-5.6-sol",
  effort: "max",
};
const grokTarget: LaneTarget = {
  harness: "grok",
  apiProvider: "xai",
  model: "grok-4.6",
  effort: "xhigh",
};
const piTarget: LaneTarget = {
  harness: "pi",
  apiProvider: "gateway",
  model: "gpt-5.6-luna",
  effort: "max",
};

describe("parseProviderOutput", () => {
  it("accepts only a settled Pi response from the requested provider and model", () => {
    const parsed = parseProviderOutput(
      piTarget,
      [
        JSON.stringify({ type: "session", id: "pi-session" }),
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "PI_OK" }],
            provider: "gateway",
            model: "gpt-5.6-luna",
            stopReason: "stop",
            usage: { input: 12, output: 3, cacheRead: 2, totalTokens: 17 },
          },
        }),
        JSON.stringify({ type: "agent_end", messages: [], willRetry: false }),
        JSON.stringify({ type: "agent_settled" }),
      ].join("\n"),
      ""
    );
    expect(parsed).toMatchObject({
      text: "PI_OK",
      reportedProvider: "gateway",
      reportedModel: "gpt-5.6-luna",
      sessionId: "pi-session",
    });
  });

  it("rejects Pi retries, aborts, route mismatches, and missing settlement", () => {
    const session = JSON.stringify({ type: "session", id: "pi-session" });
    const message = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "PI_OK" }],
        provider: "gateway",
        model: "gpt-5.6-luna",
        stopReason: "stop",
        usage: {},
        ...overrides,
      },
    });
    const settled = JSON.stringify({ type: "agent_settled" });

    expect(() => parseProviderOutput(
      piTarget,
      [
        session,
        message(),
        JSON.stringify({ type: "agent_end", messages: [], willRetry: true }),
        settled,
      ].join("\n"),
      ""
    )).toThrow("retry pending");
    expect(() => parseProviderOutput(
      piTarget,
      [
        session,
        message({ stopReason: "aborted" }),
        JSON.stringify({ type: "agent_end", messages: [], willRetry: false }),
        settled,
      ].join("\n"),
      ""
    )).toThrow("aborted");
    expect(() => parseProviderOutput(
      piTarget,
      [
        session,
        message({ provider: "other" }),
        JSON.stringify({ type: "agent_end", messages: [], willRetry: false }),
        settled,
      ].join("\n"),
      ""
    )).toThrow("requested provider");
    expect(() => parseProviderOutput(
      piTarget,
      [
        session,
        message(),
        JSON.stringify({ type: "agent_end", messages: [], willRetry: false }),
      ].join("\n"),
      ""
    )).toThrow("settled terminal sequence");
  });

  it("extracts Claude text, model, usage, cost, and session", () => {
    const parsed = parseProviderOutput(
      claudeTarget,
      JSON.stringify({
        result: "CLAUDE_OK",
        session_id: "claude-session",
        usage: { input_tokens: 10, output_tokens: 3 },
        total_cost_usd: 0.05,
        modelUsage: { "claude-fable-9-9": { inputTokens: 10 } },
      }),
      ""
    );
    expect(parsed).toMatchObject({
      text: "CLAUDE_OK",
      reportedModel: "claude-fable-9-9",
      sessionId: "claude-session",
      usage: { inputTokens: 10, outputTokens: 3 },
      costUsd: 0.05,
    });
  });

  it("extracts Codex JSONL without inventing a provider-reported model", () => {
    const parsed = parseProviderOutput(
      codexTarget,
      [
        JSON.stringify({ type: "thread.started", thread_id: "codex-session" }),
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "CODEX_OK" },
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 20,
            cached_input_tokens: 4,
            output_tokens: 5,
            reasoning_output_tokens: 2,
          },
        }),
      ].join("\n"),
      "model: gpt-5.6-sol\nreasoning effort: max\n"
    );
    expect(parsed).toMatchObject({
      text: "CODEX_OK",
      reportedModel: null,
      sessionId: "codex-session",
      usage: {
        inputTokens: 20,
        cachedInputTokens: 4,
        outputTokens: 5,
        reasoningTokens: 2,
      },
    });
  });

  it("accepts Grok's reported build suffix", () => {
    const parsed = parseProviderOutput(
      grokTarget,
      [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "progress" }] },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "GROK_OK",
          session_id: "grok-session",
          usage: {
            input_tokens: 30,
            cache_read_input_tokens: 6,
            output_tokens: 7,
            reasoning_tokens: 3,
            total_tokens: 43,
          },
          total_cost_usd: 0.02,
          modelUsage: { "grok-4.6-build": {} },
        }),
      ].join("\n"),
      ""
    );
    expect(parsed.text).toBe("GROK_OK");
    expect(parsed.reportedModel).toBe("grok-4.6-build");
    expect(reportedModelMatches(grokTarget, parsed.reportedModel)).toBe(
      true
    );
  });

  it("selects the requested Claude model when usage includes a side model", () => {
    const parsed = parseProviderOutput(
      claudeTarget,
      JSON.stringify({
        result: "CLAUDE_OK",
        modelUsage: {
          "claude-haiku-4-5-20251001": {},
          "claude-fable-9-9": {},
        },
      }),
      ""
    );
    expect(parsed.reportedModel).toBe("claude-fable-9-9");
  });

  it("matches only concrete Claude revisions from the requested rolling family", () => {
    const opusTarget: LaneTarget = { ...claudeTarget, model: "opus" };
    expect(reportedModelMatches(claudeTarget, "claude-fable-9-9")).toBe(true);
    expect(reportedModelMatches(opusTarget, "claude-opus-9")).toBe(true);
    expect(reportedModelMatches(claudeTarget, "claude-opus-9")).toBe(false);
    expect(reportedModelMatches(claudeTarget, "claude-fable-beta")).toBe(false);
    expect(reportedModelMatches(claudeTarget, "fable")).toBe(false);
    expect(reportedModelMatches(claudeTarget, "fable-preview")).toBe(false);
    expect(reportedModelMatches(grokTarget, "claude-fable-9-9")).toBe(false);
  });

  it("rejects malformed or textless responses", () => {
    expect(() =>
      parseProviderOutput(claudeTarget, "not-json", "")
    ).toThrow("valid JSON");
    expect(() =>
      parseProviderOutput(
        codexTarget,
        JSON.stringify({ type: "turn.completed" }),
        ""
      )
    ).toThrow("final agent message");
  });
});
