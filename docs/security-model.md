# Security Model (v0.1.0)

Threat model: AI output (and a compromised renderer) is untrusted. Project
files, credentials, and the host OS are assets. Every sensitive action crosses
an explicit gate; failures default to denial.

## 1. Boundaries

```text
[renderer/UI] --invoke--> [Rust commands] --> [OS]
     |                           |
     +-- policy evaluation        +-- traversal rejection, registered roots,
     +-- approval UX                  no symlinks, read-only in P1
     +-- audit events
```

The TypeScript permission engine is authoritative for agent actions; the Rust
layer re-validates independently (defense in depth).

## 2. Rules enforced from day one

1. No arbitrary AI-generated commands — execution requires allowlisting.
2. No unrestricted AI filesystem access — `FileSystemPort` + path guard.
3. Permission checks before sensitive operations (policy engine).
4. Secrets redacted from logs, audit metadata, AI context, error details.
5. API keys never in UI logs; only credential _references_ are stored.
6. No plaintext secret storage (keys live in memory per session).
7. Project data separated from application metadata (source of truth = disk).
8. IPC scoped via Tauri capabilities (`capabilities/default.json`).
9. Tool parameters validated (`assertSafeArg`, subcommand checks).
10. Path traversal rejected (`resolveInsideRoot`, Rust `reject_dangerous`).
11. No access outside registered project roots (session `allowed_roots`).
12. Symlinks never followed by the scanner; adapters must validate links.
13. Allowlists for external operations (commands, and later network).
14. Emergency stop (`CommandExecutor.setEmergencyStop`, config flag).
15. Immutable audit trail (`AuditRepository.append` only; no update/delete).

## 3. Permission engine

Evaluation order (most specific wins): agent+project → project → agent →
global → built-in defaults. Unknown permissions → require-approval
(fail-closed). Defaults: reads + git-read allow; writes, execution, installs,
network, git-write need approval; `GIT_PUSH` and `SYSTEM_ACCESS` deny.

`AgentService` evaluates policy _before every tool call_: deny aborts the run,
require-approval pauses for `onPermissionRequired` (the Approvals surface),
absence of an approval handler means rejection.

## 4. Execution guarantees

`CommandExecutor`: emergency-stop short-circuit → shell-metachar rejection on
the command → binary+subcommand allowlist → `spawn` with `shell: false` →
timeout + caller cancellation → byte-capped streamed output → audit events
(`ExecutionStarted/Completed/Failed`). Minimal env inheritance; sensitive env
must be passed explicitly.

## 5. Optimistic concurrency (future multi-agent safety)

`Patch.expectedHash` records the file hash at proposal time; application
rejects stale patches so two agents cannot blindly overwrite each other.
Snapshots capture pre-modification state for rollback. File/project locks and
conflict UI arrive in Phase 2 behind these same records.

## 6. Offline & data ownership

Project browsing, indexing, tool-only analysis, reports, mock/local models,
and persistence work offline; cloud calls fail gracefully with typed errors.
Whole projects are never silently uploaded — AI context is assembled from
explicit file lists with budgets, truncation reports, and redaction
(`buildContext`), and the UI can display included/dropped files.
