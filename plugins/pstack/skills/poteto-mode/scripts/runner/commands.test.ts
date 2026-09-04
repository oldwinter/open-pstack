import { describe, expect, it } from "bun:test";
import { invocationCommand, preflightCommand } from "./commands.ts";
import type { LaneTarget, RunnerOptions } from "./types.ts";

function options(overrides: Partial<RunnerOptions> = {}): RunnerOptions {
  return {
    parentHarness: "claude",
    target: {
      harness: "codex",
      apiProvider: "openai",
      model: "gpt-5.6-sol",
      effort: "max",
    },
    mode: "read-only",
    promptPath: "/tmp/prompt.md",
    cwd: "/tmp/worktree",
    outputPath: "/tmp/output.md",
    receiptPath: "/tmp/receipt.json",
    timeoutMs: null,
    ...overrides,
  };
}

describe("invocationCommand", () => {
  it("pins a named Codex API provider in argv", () => {
    const spec = invocationCommand({
      parentHarness: "claude",
      target: {
        harness: "codex",
        apiProvider: "gateway",
        model: "gpt-5.6-sol",
        effort: "max",
      },
      mode: "read-only",
      promptPath: "/tmp/prompt.md",
      cwd: "/tmp/worktree",
      outputPath: "/tmp/output.md",
      receiptPath: "/tmp/receipt.json",
      timeoutMs: null,
    });
    expect(spec.args).toEqual(
      expect.arrayContaining(["--config", 'model_provider="gateway"'])
    );
  });

  it("pins Codex model, effort, sandbox, cwd, and JSONL output", () => {
    const spec = invocationCommand(options());
    expect(spec.command).toBe("codex");
    expect(spec.stdin).toBe("prompt");
    expect(spec.args).toEqual([
      "exec",
      "--model",
      "gpt-5.6-sol",
      "--config",
      'model_provider="openai"',
      "--config",
      'model_reasoning_effort="max"',
      "--sandbox",
      "read-only",
      "--cd",
      "/tmp/worktree",
      "--skip-git-repo-check",
      "--ephemeral",
      "--disable",
      "plugins",
      "--disable",
      "multi_agent",
      "--disable",
      "hooks",
      "--disable",
      "memories",
      "--json",
      "-",
    ]);
    expect(spec.args).not.toContain("danger-full-access");
  });

  it("passes Claude model, effort, permissions, and no-recursion controls", () => {
    const spec = invocationCommand(
      options({
        parentHarness: "codex",
        target: {
          harness: "claude",
          apiProvider: "anthropic",
          model: "fable",
          effort: "max",
        },
      })
    );
    expect(spec.command).toBe("claude");
    expect(spec.stdin).toBe("prompt");
    expect(spec.args).toEqual([
      "-p",
      "--model",
      "fable",
      "--effort",
      "max",
      "--permission-mode",
      "plan",
      "--setting-sources",
      "project",
      "--strict-mcp-config",
      "--tools",
      "Read,Grep,Glob,Bash",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--disallowed-tools",
      "Agent,Task,WebSearch,WebFetch,Edit,Write,NotebookEdit",
      "--output-format",
      "json",
    ]);
    expect(spec.args).not.toContain("bypassPermissions");
  });

  it("limits Grok to the assigned cwd and disables recursive agents", () => {
    const spec = invocationCommand(
      options({
        target: {
          harness: "grok",
          apiProvider: "xai",
          model: "grok-4.6",
          effort: "xhigh",
        },
      })
    );
    expect(spec.command).toBe("grok");
    expect(spec.stdin).toBe("none");
    expect(spec.args).toEqual([
      "--prompt-file",
      "/tmp/prompt.md",
      "--model",
      "grok-4.6",
      "--reasoning-effort",
      "xhigh",
      "--permission-mode",
      "plan",
      "--sandbox",
      "read-only",
      "--tools",
      "read_file,grep,list_dir,run_terminal_cmd",
      "--disallowed-tools",
      "Agent,search_tool,use_tool",
      "--output-format",
      "streaming-messages-json",
      "--cwd",
      "/tmp/worktree",
      "--no-subagents",
      "--disable-web-search",
      "--verbatim",
    ]);
  });

  it("uses bounded write modes without blanket bypasses", () => {
    const codex = invocationCommand(options({ mode: "isolated-write" }));
    expect(codex.args).toEqual(
      expect.arrayContaining(["--sandbox", "workspace-write"])
    );
    const grok = invocationCommand(
      options({
        target: {
          harness: "grok",
          apiProvider: "xai",
          model: "grok-4.6",
          effort: "xhigh",
        },
        mode: "isolated-write",
      })
    );
    expect(grok.args).toEqual(
      expect.arrayContaining([
        "--permission-mode",
        "acceptEdits",
        "--sandbox",
        "workspace",
        "--tools",
        "read_file,grep,list_dir,run_terminal_cmd,search_replace",
      ])
    );
    expect(grok.args).not.toContain("--always-approve");

    const claude = invocationCommand(
      options({
        parentHarness: "codex",
        target: {
          harness: "claude",
          apiProvider: "anthropic",
          model: "fable",
          effort: "max",
        },
        mode: "isolated-write",
      })
    );
    expect(claude.args).toEqual(
      expect.arrayContaining([
        "--permission-mode",
        "acceptEdits",
        "--tools",
        "Read,Write,Edit,Grep,Glob,Bash",
      ])
    );
  });

  it("covers low, medium, and high for every external provider", () => {
    const cases: Array<{
      readonly target: LaneTarget;
      readonly flag: (effort: "low" | "medium" | "high") => string[];
    }> = [
      {
        target: {
          harness: "claude",
          apiProvider: "anthropic",
          model: "fable",
          effort: "max",
        },
        flag: (effort: "low" | "medium" | "high") => ["--effort", effort],
      },
      {
        target: {
          harness: "codex",
          apiProvider: "openai",
          model: "gpt-5.6-sol",
          effort: "max",
        },
        flag: (effort: "low" | "medium" | "high") => [
          "--config",
          `model_reasoning_effort="${effort}"`,
        ],
      },
      {
        target: {
          harness: "grok",
          apiProvider: "xai",
          model: "grok-4.6",
          effort: "xhigh",
        },
        flag: (effort: "low" | "medium" | "high") => [
          "--reasoning-effort",
          effort,
        ],
      },
    ];
    for (const { target, flag } of cases) {
      for (const effort of ["low", "medium", "high"] as const) {
        const spec = invocationCommand(options({ target: { ...target, effort } }));
        expect(spec.args).toEqual(expect.arrayContaining(flag(effort)));
      }
    }
  });

  it("uses structured Pi auth preflight and a read-only JSON invocation", () => {
    const target: LaneTarget = {
      harness: "pi",
      apiProvider: "gateway",
      model: "gpt-5.6-luna",
      effort: "max",
    };
    expect(preflightCommand(target)).toEqual({
      command: "pi",
      args: [
        "auth",
        "check",
        "--provider",
        "gateway",
        "--model",
        "gpt-5.6-luna",
        "--json",
        "--no-refresh",
      ],
      stdin: "none",
    });
    const spec = invocationCommand(options({ target }));
    expect(spec).toEqual({
      command: "pi",
      args: [
        "--print",
        "--mode",
        "json",
        "--provider",
        "gateway",
        "--model",
        "gpt-5.6-luna",
        "--thinking",
        "max",
        "--no-session",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--approve",
        "--offline",
        "--tools",
        "read,grep,find,ls",
      ],
      stdin: "prompt",
    });
  });
});
