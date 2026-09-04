# Provider dispatch

pstack model choices use schema 2 harness/API-provider descriptors:

```text
<harness>[<api-provider>]:<model>@<effort>
```

Endpoint URLs, credentials, headers, and executable paths are never part of a
descriptor. They remain in each CLI's trusted user configuration.

## Model matrix

| Family | Upstream pstack choice | Harness | API provider | Model | Default effort | Selectable efforts | Claude-native agent stem |
|---|---|---|---|---|---|---|---|
| fable | fable | claude | anthropic | fable | max | low medium high xhigh max | fable |
| sol | gpt-5.6-sol-max | codex | openai | gpt-5.6-sol | max | low medium high xhigh max | - |
| grok | grok-4.6-fast-xhigh | grok | xai | grok-4.6 | xhigh | low medium high xhigh max | - |
| opus | opus | claude | anthropic | opus | xhigh | low medium high xhigh max | opus |

The allowed effort universe is exactly `low`, `medium`, `high`, `xhigh`, `max`. First-run requested efforts are the Default effort cell of each row. A Claude-native agent stem of `-` means the family has no Claude-native agent. Otherwise the shipped agent name is `pstack-<stem>-<effort>`.

`fable` and `opus` are Claude Code's rolling aliases. Claude resolves each alias to the latest available family revision. A runner receipt keeps the requested alias in `target.model` and the concrete provider-reported revision in `routeProof.model.reported`; verification accepts only a numeric `claude-fable-*` or `claude-opus-*` revision from the matching family.

## Read-time normalization

Normalize configured descriptors before matching them to the matrix or choosing a route. First expand released schema 1 descriptors in memory: `claude:*` uses API provider `anthropic`, `codex:*` uses `openai`, and `grok:*` uses `xai`. Then, if a Claude model starts with `claude-fable-` or `claude-opus-` and its remaining revision contains only digits and hyphens, replace that model component in memory with `fable` or `opus`. Preserve harness, API provider, effort, role, and lane order. Use only the normalized schema 2 descriptor for native dispatch or runner argv. Never pass the versioned predecessor to Claude.

This read-time rule makes an older installed sheet use the latest family revision immediately without writing user files. Once per parent run, report that the persisted sheet is stale and that `/setup-pstack` will rewrite it after its normal probes and confirmation. Unknown versioned Claude models remain invalid. The external runner rejects a missed Fable or Opus version pin instead of silently executing it.

`fast` is part of Cursor's Grok selector, not a Grok Build CLI model or effort flag. The portable Grok route pins the current CLI model `grok-4.6`. The first-run Grok effort is `xhigh`.

## The parent owns the route

The top-level harness resolves the route once. A child receives an assigned execution harness, API provider, model, effort, access mode, prompt, working directory, and output path. A child never detects the parent, chooses a route, or launches another model. Environment markers may corroborate the top-level harness before fan-out, but nested processes inherit parent markers and must not use them for routing.

| Parent | `claude[anthropic]:*` | `codex[openai]:*` | `codex[<named>]:*` | `grok[xai]:*` | `pi[<named>]:*` |
|---|---|---|---|---|---|
| Claude Code | native `Agent` | external runner | external runner | external runner | external runner |
| Codex | external runner | native `spawn_agent` | external runner | external runner | external runner |

`inherit-parent` and `auto` remain aliases. They use the parent's current model and effort through its native subagent primitive. In a panel they still consume one lane, but they reduce provider diversity; say so in the synthesis record.

## Native lanes

Native dispatch avoids a second CLI startup and its base context.

- Claude Code: match the descriptor's `(harness, API provider, model)` to one model-matrix row, then dispatch it through `pstack-<stem>-<effort>` using that row's Claude-native agent stem and the descriptor's effort. Those definitions select the rolling model alias, requested effort, and `background: true`. `pstack-fable-max` and `pstack-opus-xhigh` remain in that set. Pass the complete task, grounding paths, access mode, and unique output location in the `Agent` prompt. Retain the task handle and drain it only after fan-out.
- Codex: call `spawn_agent` with the descriptor's model and `reasoning_effort`, the complete task, grounding paths, access mode, and unique output location. Use an isolated worktree for a writer. Codex subagents already run concurrently.

Do not send a parent-native target to the external runner. It rejects Claude/Anthropic under a Claude parent and Codex/OpenAI under a Codex parent. A named non-OpenAI Codex provider under a Codex parent is external because the native subagent primitive cannot select that route.

## External lanes

The launcher lives at `skills/poteto-mode/scripts/runner/pstack-runner` under the installed plugin. The parent writes the complete candidate prompt to a unique file, creates a unique output directory or worktree, and invokes the launcher directly. Do not put another agent in front of it.

```text
pstack-runner \
  --parent-harness <claude|codex> \
  --harness <claude|codex|grok|pi> \
  --api-provider <configured provider id> \
  --model <real CLI model> \
  --effort <low|medium|high|xhigh|max> \
  --mode <read-only|isolated-write> \
  --prompt <unique prompt file> \
  --cwd <repository or dedicated worktree> \
  --output <unique final-response file> \
  --receipt <unique receipt file> \
  [--timeout <seconds>]
```

Pass arguments as an argv array or quote every path. Never interpolate prompt text into a shell command. There are no endpoint or executable override flags. The launcher preflights the assigned CLI and authentication, invokes the model exactly once, disables recursive agents and ambient skill dispatch where the CLI supports it, restricts the built-in tool surface, and records the exact harness/API-provider/model/effort flags. External lanes do not receive the parent's MCP surface. Keep MCP-dependent Why and Reflect roles on `inherit-parent` or `auto`. The launcher never falls back.

Claude keeps `--setting-sources project`. Before executable lookup, the launcher structurally reads the `env` object in `~/.claude/settings.json`. It projects only the three connection keys `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_API_KEY`, plus the four provider model pins `ANTHROPIC_DEFAULT_FABLE_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, and `ANTHROPIC_DEFAULT_HAIKU_MODEL`. The complete projection replaces inherited values for those keys. A custom base URL requires exactly one credential key. Malformed or ambiguous settings fail before preflight. A configured model pin becomes the exact expected model in Claude's result. The same frozen environment is used for lookup, preflight, and execution. Configuration provenance records only the source and imported or replaced key names. Endpoint and credential values never enter the receipt.

Codex/OpenAI preflights with `codex login status`. A named Codex provider preflights with `codex --version`, then pins it as the exact `--config model_provider="<id>"` argv value; its provider definition and authentication remain in `~/.codex/config.toml`. Grok requires exit 0, one documented positive authentication banner, no explicit negative banner, and exact requested membership in the `Available models:` rows.

Vanilla Pi preflights with `pi auth check --provider <id> --model <model> --json --no-refresh`. It runs in JSON print mode through stdin with the exact provider, model, and thinking level, offline startup, no session, extensions, skills, prompt templates, or themes, and the read-only `read,grep,find,ls` allowlist. Pi preserves trusted project instructions but supports only `read-only`; `isolated-write` fails before any path reservation or spawn. Success requires the requested provider/model in the final assistant `message_end`, a non-retrying `agent_end`, and a later `agent_settled` event.

Grok authentication preflight has one bounded retry. If the first `grok models` result would be classified as unauthenticated, the runner waits five seconds and tries the same preflight once more. A second failure is terminal. The delay and second attempt share the runner's absolute deadline and cancellation latch, and the receipt keeps evidence from both attempts. Model execution is never retried.

The parent tool sandbox still governs whether a subscribed child CLI can reach its credentials and network. Run setup's live probe from the actual parent profile. A blocked external CLI is a loud dropout, not a reason to elevate permissions or substitute a model silently.

The parent invocation must itself be resumable background work:

- Claude Code: call the launcher through a Bash tool invocation with `run_in_background: true` and retain its task ID. A foreground Bash tool call has an automatic ten-minute ceiling even when the runner's own timeout is longer. Shelling out with `&` and losing the task handle is not equivalent.
- Codex: run the launcher in a persistent exec session that returns a session ID, then wait or poll that handle. Do not hold one foreground tool call open for the model's full runtime.

Start the background process, continue launching the other lanes, then drain their handles. Native and external lanes belong in the same fan-out phase.

The runner and its preflight have no implicit timeout. Do not invent a duration from role, mode, or a convenient round number; real implementation lanes can run for 90 minutes or much longer. Pass `--timeout` only when the user, an external service deadline, or a measured task contract supplies a real bound. That value starts at wrapper entry, before module loading and argument parsing, and remains one absolute deadline across setup, preflight, model execution, and output capture. It is never a fresh allowance per child, and long waits are armed in runtime-safe chunks without shortening the supplied deadline. Otherwise supervise liveness through the retained background task/session handle and cancel manually only on evidence that the run is dead. Cancel through that retained handle so the runner receives SIGINT or SIGTERM, sends it to an active child when one remains, stops waiting on inherited output pipes, removes the empty output reservation, and writes a `cancelled` receipt. Preserve that receipt; a retry is a new attempt with new unique output and receipt paths. Unchanged running state is not a dropout, and Claude's ten-minute foreground ceiling is never a reason to terminate a healthy lane.

Read-only mode maps to Claude plan mode with project-only settings and an explicit tool list, Codex's read-only sandbox, Grok plan mode plus its `read-only` sandbox and read-oriented tool list, and Pi's explicit read-only tool allowlist. Grok's built-in read-only profile deliberately keeps its own state and system temporary directories writable, so point a read-only Grok lane at the actual checkout rather than a worktree under `/tmp`, `/var/tmp`, or the host's temporary directory. `isolated-write` maps to Claude `acceptEdits` with project-only settings, Codex `workspace-write`, and Grok `acceptEdits` plus its `workspace` sandbox and write-capable tool list; Pi rejects it. Give every writer only a dedicated worktree or output directory. Never route a writer into the primary checkout.

Every concurrent external lane needs distinct prompt, output, and receipt paths. The launcher reserves output and receipt paths exclusively, creates them with mode `0600`, and refuses to overwrite them.

## Completion and dropouts

Success requires all of these:

1. Exit status `0`.
2. Receipt status `complete`.
3. Receipt `schemaVersion` is `2`, and `target` exactly matches the assigned harness, API provider, model, and effort.
4. `routeProof.apiProvider` and `routeProof.model` contain either verified provider reports or the documented route evidence. Pi reports and verifies both values. Claude and Grok API providers are verified by the fixed harness contract. Codex records `pinned-argv` with no fabricated provider/model report. For Claude's `fable` and `opus` aliases, the concrete model report must belong to the requested family.
5. A non-empty output file.

The receipt also carries redacted configuration provenance, elapsed time, token usage when the CLI exposes it, and cost when available. It never stores credential values, endpoint URLs, or raw Claude settings JSON. Keep it with the arena or review artifacts so parent-harness comparisons are evidence-based.

Any missing CLI, failed login, unavailable model, explicit timeout, cancellation, catchable post-reservation launcher failure, non-zero child exit, malformed result, or model mismatch is a receipt-bearing dropout. Record it and apply the calling skill's existing dropout policy. A `cancelled` receipt proves that the runner received the signal; its `signal` field is non-null only when the runner sent that signal to a still-active direct CLI child, and remains null when cancellation only stopped a post-exit pipe drain. The provider CLI owns any processes it starts beneath that direct child; the receipt does not claim a process-tree kill. Do not delete or overwrite the receipt. Never substitute the parent model, retry another provider, or reinterpret an external descriptor as a native model slug.

Start native and external lanes in the same fan-out phase, then wait for all of them before judging. A judge must not read candidate paths while their owners are still writing.
