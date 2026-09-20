# ADR-001 — Desktop framework: Tauri 2

- Status: accepted (Prompt 1)
- Context: need a cross-platform (Windows/macOS/Linux) desktop shell with deep
  filesystem integration, child-process management, small resource footprint,
  and a security story compatible with AI-driven file operations.

## Decision

Build the shell on **Tauri 2** (Rust backend + system webview), with the
frontend as a Vite SPA bundled into `apps/desktop/dist`.

## Alternatives

- **Electron**: mature ecosystem, huge plugin/tooling surface; but 150MB+
  memory baseline, full Chromium per app, larger attack surface, and IPC
  without a capability model.
- **Neutralinojs / Wails**: lighter, but smaller ecosystems, weaker
  process/FS plugin coverage, and less certain long-term maintenance.

## Rationale

- Memory/binary size fits a tool that scans large repos (Rust backend,
  native webview, ~10MB binaries).
- Capability-based IPC allowlist + per-command validation matches the
  permission-engine design (defense in depth with ADR-009/010).
- Rust ownership model suits hashing/indexing/execution workloads later.
- Both toolchains (Node 24, Rust 1.98) are available in this environment.

## Tradeoffs

- Contributors need Rust for backend changes; webview debugging is
  platform-specific (WebView2/WKWebView/WebKitGTK).
- Plugin ecosystem is younger than Electron's; we wrap all Tauri APIs behind
  ports (`TauriFileSystem`, `tauri-bridge`) so a backend swap stays local.

## Consequences

- `apps/desktop/src-tauri` owns commands, capabilities, and session roots.
- Frontend must run without Tauri (browser preview + tests) — all Tauri
  access is injected/guarded (`isTauri()`, injectable `invoke`).
