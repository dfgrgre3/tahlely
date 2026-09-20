# AI & Agent Architecture (v0.1.0)

## 1. Gateway

`AIProvider` (`packages/ai/src/provider.ts`) is the only interface the app
sees: `listModels()`, `chat()`, `stream()`. Vendors plug in via
`ProviderFactory` keyed by `ProviderKind`:

- `openai-compatible` — OpenAI, DeepSeek, OpenRouter, Ollama/LM Studio,
  custom endpoints (`/chat/completions`; per-call timeout, abort, typed
  auth/rate-limit/network errors; key travels in-memory only).
- `local` — deterministic `MockProvider` (tests, offline, Prompt-1 shell).
- `anthropic | google | deepseek | openrouter | custom` — reserved kinds;
  dedicated adapters land here without touching callers.

`ProviderRegistry` namespaces models as `<providerId>/<model>`, caches
instances, and stores model capabilities/pricing/host (`cloud | local`) so
later phases can route cloud/local/hybrid without rewrites.

## 2. Context / retrieval boundary

`buildContext(system, goal, files, { maxChars, maxFiles })` is the
data-ownership gate: explicit file lists only, per-file + global truncation
with `…[truncated N chars]` markers, secret redaction, and a report of
`includedFiles / droppedFiles / redacted / totalChars`. Retrieval (index +
graph queries feeding this builder) is the Phase-2 scaling story; the builder
contract is stable now.

## 3. Agent runtime (Prompt-1 scope)

`AgentService.run()`: assemble redacted context → single model call →
execute returned tool calls **in order behind the policy gate** → persist run
→ emit `AgentStarted/AgentCompleted`. Guarantees:

- unknown tools abort with a security-violation error;
- `deny` aborts; `require-approval` pauses for human decision (no handler =
  rejection);
- steps are capped (`maxSteps`); cancellation aborts promptly;
- write-capable tools are unwired in the desktop (`AGENT_TOOL_UNWIRED`) —
  agents reason and cite, humans approve mutations.

The full autonomous loop (planner, multi-step tool iteration, file locks,
patch conflicts, multi-agent concurrency, run isolation) extends this service
in Phase 2. Built-in templates: Reviewer, Analyst, Documenter
(`packages/agents/src/builtins.ts`).

## 4. Modes

Tool-only runs offline with zero model calls; AI-only reasons over assembled
context; hybrid runs deterministic analyzers first and reserves AI for
triage/explanation. The mode is stored on every `AnalysisRun`.
