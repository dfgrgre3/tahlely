# ADR-008 — AI provider abstraction: OpenAI-compatible core

- Status: accepted (Prompt 1)

## Decision

Provider-agnostic **`AIProvider`** with an **OpenAI-compatible HTTP core**
(`OpenAiCompatibleProvider`): one protocol covers OpenAI, DeepSeek,
OpenRouter, Ollama/LM Studio, and custom endpoints. Dedicated adapters
(Anthropic, Google, …) plug in as `ProviderFactory` entries later.

## Alternatives

- **Vendor SDK per provider**: richest features per vendor; but N code
  paths, N secret-handling stories, lock-in by default.
- **LangChain-style framework**: fast prototyping; but heavy dependency,
  opinionated abstractions that leak into the domain.

## Rationale

- Lowest-common-denominator `/chat/completions` maximizes local + custom
  endpoint support (the hybrid story) with one well-tested path.
- No vendor lock-in; models are namespaced `<provider>/<model>` with
  capability/host metadata for future routing.

## Tradeoffs

- Vendor-specific features (native vision, provider tools) wait for
  dedicated adapters; streaming is buffered in P1 (same interface).

## Consequences

- Secrets travel in-memory only, per call; only endpoint + credential
  _references_ persist.
- `MockProvider` keeps tests/offline deterministic.
