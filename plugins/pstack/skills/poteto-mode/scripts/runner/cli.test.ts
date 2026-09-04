import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { parseArgs } from "./cli.ts";

function argv(extra: readonly string[] = []): string[] {
  return [
    "--parent-harness",
    "claude",
    "--harness",
    "codex",
    "--api-provider",
    "openai",
    "--model",
    "gpt-5.6-sol",
    "--effort",
    "max",
    "--mode",
    "read-only",
    "--prompt",
    join(process.cwd(), "prompt.md"),
    "--cwd",
    process.cwd(),
    "--output",
    join(process.cwd(), "output.md"),
    "--receipt",
    join(process.cwd(), "receipt.json"),
    ...extra,
  ];
}

describe("runner CLI parsing", () => {
  it("does not invent a timeout", () => {
    expect(parseArgs(argv())?.timeoutMs).toBeNull();
  });

  it("honors an explicit positive timeout", () => {
    expect(parseArgs(argv(["--timeout", "5400"]))?.timeoutMs).toBe(5_400_000);
  });

  it("rejects a non-positive timeout", () => {
    expect(() => parseArgs(argv(["--timeout", "0"]))).toThrow(
      "greater than zero"
    );
  });

  it("parses a provider-qualified target", () => {
    expect(parseArgs(argv())?.target).toEqual({
      harness: "codex",
      apiProvider: "openai",
      model: "gpt-5.6-sol",
      effort: "max",
    });
  });

  it("preserves a named Codex provider under a Codex parent", () => {
    const values = argv();
    values[1] = "codex";
    values[5] = "gateway";

    expect(parseArgs(values)).toMatchObject({
      parentHarness: "codex",
      target: {
        harness: "codex",
        apiProvider: "gateway",
        model: "gpt-5.6-sol",
      },
    });
  });

  it("rejects arbitrary endpoint and executable flags", () => {
    expect(() => parseArgs(argv(["--endpoint", "https://example.invalid"])))
      .toThrow("Unknown option");
    expect(() => parseArgs(argv(["--executable", "/tmp/custom-runner"])))
      .toThrow("Unknown option");
  });
});
