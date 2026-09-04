import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_PROVIDER_ENV_KEYS,
  type ClaudeProviderEnvKey,
  type ConfigurationProvenance,
  type LaneTarget,
  type ParentHarness,
} from "./types.ts";

const CODEX_IDENTITY = [
  "CODEX_THREAD_ID",
  "CODEX_SESSION_ID",
  "CODEX_CI",
  "CODEX_SHELL",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
] as const;

const CLAUDE_IDENTITY = [
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
] as const;

type JsonObject = Record<string, unknown>;

export type ProviderEnvironmentResolution =
  | {
      readonly kind: "ready";
      readonly env: Readonly<NodeJS.ProcessEnv>;
      readonly configuration: ConfigurationProvenance;
      readonly expectedReportedModel: string | null;
    }
  | {
      readonly kind: "invalid";
      readonly message: string;
      readonly configuration: ConfigurationProvenance;
    };

function jsonObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

export function childEnvironment(
  parentHarness: ParentHarness,
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const result = { ...source };
  const remove = parentHarness === "claude" ? CLAUDE_IDENTITY : CODEX_IDENTITY;
  for (const key of remove) delete result[key];
  return result;
}

function processConfiguration(): ConfigurationProvenance {
  return {
    source: "process-environment",
    importedKeys: [],
    replacedKeys: [],
  };
}

function harnessConfiguration(): ConfigurationProvenance {
  return {
    source: "harness-user-configuration",
    importedKeys: [],
    replacedKeys: [],
  };
}

function frozenEnvironment(
  environment: NodeJS.ProcessEnv
): Readonly<NodeJS.ProcessEnv> {
  return Object.freeze(environment);
}

function invalidClaudeConfiguration(message: string): ProviderEnvironmentResolution {
  return {
    kind: "invalid",
    message,
    configuration: {
      source: "claude-user-settings",
      importedKeys: [],
      replacedKeys: [],
    },
  };
}

function claudeSettingsPath(source: NodeJS.ProcessEnv): string {
  const sourceHome = source.HOME?.trim();
  const home = sourceHome && sourceHome.length > 0 ? sourceHome : homedir();
  return join(home, ".claude", "settings.json");
}

function expectedClaudeModel(
  target: LaneTarget,
  environment: Readonly<NodeJS.ProcessEnv>
): string | null {
  if (target.harness !== "claude") return null;
  const key = target.model === "fable"
    ? "ANTHROPIC_DEFAULT_FABLE_MODEL"
    : target.model === "opus"
      ? "ANTHROPIC_DEFAULT_OPUS_MODEL"
      : target.model === "sonnet"
        ? "ANTHROPIC_DEFAULT_SONNET_MODEL"
        : target.model === "haiku"
          ? "ANTHROPIC_DEFAULT_HAIKU_MODEL"
          : null;
  return key === null ? null : environment[key]?.trim() || null;
}

export function resolveProviderEnvironment(
  parentHarness: ParentHarness,
  target: LaneTarget,
  source: NodeJS.ProcessEnv = process.env
): ProviderEnvironmentResolution {
  const base = childEnvironment(parentHarness, source);
  if (target.harness !== "claude") {
    return {
      kind: "ready",
      env: frozenEnvironment(base),
      configuration: harnessConfiguration(),
      expectedReportedModel: null,
    };
  }

  const settingsPath = claudeSettingsPath(source);
  if (!existsSync(settingsPath)) {
    return {
      kind: "ready",
      env: frozenEnvironment(base),
      configuration: processConfiguration(),
      expectedReportedModel: expectedClaudeModel(target, base),
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return invalidClaudeConfiguration("Claude user settings are not valid JSON");
  }
  const settings = jsonObject(raw);
  if (settings === null) {
    return invalidClaudeConfiguration("Claude user settings must contain a JSON object");
  }
  if (!("env" in settings)) {
    return {
      kind: "ready",
      env: frozenEnvironment(base),
      configuration: processConfiguration(),
      expectedReportedModel: expectedClaudeModel(target, base),
    };
  }
  const settingsEnv = jsonObject(settings.env);
  if (settingsEnv === null) {
    return invalidClaudeConfiguration("Claude user settings env must contain a JSON object");
  }

  const projection = new Map<ClaudeProviderEnvKey, string>();
  for (const key of CLAUDE_PROVIDER_ENV_KEYS) {
    if (!(key in settingsEnv)) continue;
    const value = settingsEnv[key];
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
      return invalidClaudeConfiguration(`Claude user settings ${key} must be a non-empty string`);
    }
    projection.set(key, value);
  }
  if (projection.size === 0) {
    return {
      kind: "ready",
      env: frozenEnvironment(base),
      configuration: processConfiguration(),
      expectedReportedModel: expectedClaudeModel(target, base),
    };
  }
  if (projection.has("ANTHROPIC_AUTH_TOKEN") && projection.has("ANTHROPIC_API_KEY")) {
    return invalidClaudeConfiguration(
      "Claude user settings must select only one Anthropic credential key"
    );
  }
  if (
    projection.has("ANTHROPIC_BASE_URL")
    && !projection.has("ANTHROPIC_AUTH_TOKEN")
    && !projection.has("ANTHROPIC_API_KEY")
  ) {
    return invalidClaudeConfiguration(
      "Claude user settings ANTHROPIC_BASE_URL requires one Anthropic credential key"
    );
  }

  const replacedKeys = CLAUDE_PROVIDER_ENV_KEYS.filter((key) => base[key] !== undefined);
  for (const key of CLAUDE_PROVIDER_ENV_KEYS) delete base[key];
  for (const [key, value] of projection) base[key] = value;
  return {
    kind: "ready",
    env: frozenEnvironment(base),
    expectedReportedModel: expectedClaudeModel(target, base),
    configuration: {
      source: "claude-user-settings",
      importedKeys: CLAUDE_PROVIDER_ENV_KEYS.filter((key) => projection.has(key)),
      replacedKeys,
    },
  };
}
