export const PARENT_HARNESSES = ["claude", "codex"] as const;
export const EXECUTION_HARNESSES = ["claude", "codex", "grok", "pi"] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const ACCESS_MODES = ["read-only", "isolated-write"] as const;
export const CLAUDE_PROVIDER_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
] as const;

export type ParentHarness = (typeof PARENT_HARNESSES)[number];
export type ExecutionHarness = (typeof EXECUTION_HARNESSES)[number];
export type Effort = (typeof EFFORTS)[number];
export type AccessMode = (typeof ACCESS_MODES)[number];
export type ClaudeProviderEnvKey = (typeof CLAUDE_PROVIDER_ENV_KEYS)[number];

interface TargetRoute {
  readonly model: string;
  readonly effort: Effort;
}

export type LaneTarget =
  | (TargetRoute & {
      readonly harness: "claude";
      readonly apiProvider: "anthropic";
    })
  | (TargetRoute & {
      readonly harness: "codex";
      readonly apiProvider: string;
    })
  | (TargetRoute & {
      readonly harness: "grok";
      readonly apiProvider: "xai";
    })
  | (TargetRoute & {
      readonly harness: "pi";
      readonly apiProvider: string;
    });

export interface RunnerOptions {
  readonly parentHarness: ParentHarness;
  readonly target: LaneTarget;
  readonly mode: AccessMode;
  readonly promptPath: string;
  readonly cwd: string;
  readonly outputPath: string;
  readonly receiptPath: string;
  readonly timeoutMs: number | null;
}

export type ReceiptStatus =
  | "complete"
  | "cancelled"
  | "unavailable-cli"
  | "unauthenticated"
  | "unavailable-model"
  | "timed-out"
  | "child-failed"
  | "malformed-output";

export interface NormalizedUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
}

export interface ParsedOutput {
  readonly text: string;
  readonly reportedProvider: string | null;
  readonly reportedModel: string | null;
  readonly sessionId: string | null;
  readonly usage: NormalizedUsage | null;
  readonly costUsd: number | null;
}

export type RouteEvidence =
  | "provider-report"
  | "pinned-argv"
  | "harness-contract";

export interface RouteAssertion {
  readonly requested: string;
  readonly reported: string | null;
  readonly verified: boolean;
  readonly evidence: RouteEvidence | null;
}

export interface RouteProof {
  readonly apiProvider: RouteAssertion;
  readonly model: RouteAssertion;
}

export interface ConfigurationProvenance {
  readonly source:
    | "process-environment"
    | "claude-user-settings"
    | "harness-user-configuration";
  readonly importedKeys: readonly ClaudeProviderEnvKey[];
  readonly replacedKeys: readonly ClaudeProviderEnvKey[];
}

export interface RunnerReceipt {
  readonly schemaVersion: 2;
  readonly status: ReceiptStatus;
  readonly parentHarness: ParentHarness;
  readonly target: LaneTarget;
  readonly mode: AccessMode;
  readonly cwd: string;
  readonly promptPath: string;
  readonly outputPath: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly elapsedMs: number;
  readonly executable: string | null;
  readonly configuration: ConfigurationProvenance;
  readonly preflight: {
    readonly argv: readonly string[];
    readonly status: "passed" | "failed" | "timed-out" | "cancelled" | "not-run";
    readonly evidence: string;
  };
  readonly argv: readonly string[];
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly routeProof: RouteProof;
  readonly sessionId: string | null;
  readonly usage: NormalizedUsage | null;
  readonly costUsd: number | null;
  readonly error: {
    readonly message: string;
    readonly evidence: string;
  } | null;
}

export class UsageError extends Error {}
