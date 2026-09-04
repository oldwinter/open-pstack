import type {
  AccessMode,
  Effort,
  LaneTarget,
  RunnerOptions,
} from "./types.ts";

export interface CommandSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin: "prompt" | "none";
}

export function preflightCommand(target: LaneTarget): CommandSpec {
  switch (target.harness) {
    case "claude":
      return {
        command: "claude",
        args: ["auth", "status", "--json"],
        stdin: "none",
      };
    case "codex":
      return target.apiProvider === "openai"
        ? {
            command: "codex",
            args: ["login", "status"],
            stdin: "none",
          }
        : { command: "codex", args: ["--version"], stdin: "none" };
    case "grok":
      return { command: "grok", args: ["models"], stdin: "none" };
    case "pi":
      return {
        command: "pi",
        args: [
          "auth",
          "check",
          "--provider",
          target.apiProvider,
          "--model",
          target.model,
          "--json",
          "--no-refresh",
        ],
        stdin: "none",
      };
  }
}

function claudeDeniedTools(mode: AccessMode): string {
  const always = ["Agent", "Task", "WebSearch", "WebFetch"];
  const readonly = ["Edit", "Write", "NotebookEdit"];
  return [...always, ...(mode === "read-only" ? readonly : [])].join(",");
}

function claudeTools(mode: AccessMode): string {
  return mode === "read-only"
    ? "Read,Grep,Glob,Bash"
    : "Read,Write,Edit,Grep,Glob,Bash";
}

function codexSandbox(mode: AccessMode): string {
  return mode === "read-only" ? "read-only" : "workspace-write";
}

function grokSandbox(mode: AccessMode): string {
  return mode === "read-only" ? "read-only" : "workspace";
}

function grokTools(mode: AccessMode): string {
  const readonly = ["read_file", "grep", "list_dir", "run_terminal_cmd"];
  return [...readonly, ...(mode === "isolated-write" ? ["search_replace"] : [])].join(",");
}

function permissionMode(mode: AccessMode): string {
  return mode === "read-only" ? "plan" : "acceptEdits";
}

function effortOverride(effort: Effort): string {
  return `model_reasoning_effort=${JSON.stringify(effort)}`;
}

function providerOverride(apiProvider: string): string {
  return `model_provider=${JSON.stringify(apiProvider)}`;
}

export function invocationCommand(options: RunnerOptions): CommandSpec {
  const target = options.target;
  switch (target.harness) {
    case "claude":
      return {
        command: "claude",
        args: [
          "-p",
          "--model",
          target.model,
          "--effort",
          target.effort,
          "--permission-mode",
          permissionMode(options.mode),
          "--setting-sources",
          "project",
          "--strict-mcp-config",
          "--tools",
          claudeTools(options.mode),
          "--no-session-persistence",
          "--disable-slash-commands",
          "--disallowed-tools",
          claudeDeniedTools(options.mode),
          "--output-format",
          "json",
        ],
        stdin: "prompt",
      };
    case "codex":
      return {
        command: "codex",
        args: [
          "exec",
          "--model",
          target.model,
          "--config",
          providerOverride(target.apiProvider),
          "--config",
          effortOverride(target.effort),
          "--sandbox",
          codexSandbox(options.mode),
          "--cd",
          options.cwd,
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
        ],
        stdin: "prompt",
      };
    case "grok":
      return {
        command: "grok",
        args: [
          "--prompt-file",
          options.promptPath,
          "--model",
          target.model,
          "--reasoning-effort",
          target.effort,
          "--permission-mode",
          permissionMode(options.mode),
          "--sandbox",
          grokSandbox(options.mode),
          "--tools",
          grokTools(options.mode),
          "--disallowed-tools",
          "Agent,search_tool,use_tool",
          "--output-format",
          "streaming-messages-json",
          "--cwd",
          options.cwd,
          "--no-subagents",
          "--disable-web-search",
          "--verbatim",
        ],
        stdin: "none",
      };
    case "pi":
      return {
        command: "pi",
        args: [
          "--print",
          "--mode",
          "json",
          "--provider",
          target.apiProvider,
          "--model",
          target.model,
          "--thinking",
          target.effort,
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
      };
  }
}
