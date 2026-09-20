# Domain Model (v0.1.0)

Framework-free entities in `packages/domain/src`. All are plain
JSON-serializable interfaces — they cross Tauri IPC, workers, and SQLite
unchanged. Branded ids (`newId('prj')` → `ProjectId`) prevent cross-entity
mixups at compile time with zero runtime cost.

## Project / workspace

```text
Workspace { id, name, projectIds }
└── Project { id, name, rootPath, kind, languages, frameworks,
              packageManagers, entryPoints, settings }
    ├── FileNode { path, relativePath, language, size, hash?, modifiedAt?,
    │              ignored, generated, binary, analyzed, importance, risk }
    ├── DependencyGraph { nodes, edges, cycles }
    ├── Analyses (AnalysisRun[] + Findings)
    ├── Conversations (with messages, analyses, reports, agent runs)
    ├── Agents + AgentRuns
    ├── Reports
    ├── Snapshots + Patches
    ├── Policies + PermissionRequests
    └── Audit History (append-only)
```

A project is identified independently of conversations: many conversations,
agents, and analyses reference one project (`projectId` on every record).

## Analysis

`AnalysisRun { mode, profileId, analyzerIds, targetPaths, status, summary }`.
`mode` ∈ tool-only | ai-only | hybrid is preserved per run. Profiles
(quick/standard/deep/production/security/architecture/custom) declare
analyzers, timeouts, AI use, and execution rights (`packages/analysis`).

## Finding (canonical)

`id, projectId, analysisId, fileId?, path?, line/column/endLine/endColumn,
category, ruleId, title, description, impact?, severity (critical/high/medium/
low/info), confidence (verified/high/medium/low/speculative), source
(analyzer/compiler/linter/runtime/ai/user/combined), evidence[], recommendation?,
suggestedFix?, relatedFiles[], relatedSymbols[], status
(open/acknowledged/resolved/suppressed), createdAt, updatedAt.`

## Evidence

Each finding carries typed evidence (`code-excerpt | analyzer | compiler |
linter | runtime | dependency | ai-reasoning | user` + confidence). AI claims
are stored as `ai-reasoning` — never weighted as compiler/static proof.

## Conversation

A persistent project workspace: `Conversation { projectId, title, status
(active/archived), messageCount, lastActiveAt, activeAgentIds,
pinnedFilePaths }` + `Message { role, body, attachments[], analysisIds[],
reportIds[], agentRunIds[] }`. Supports create/rename/archive/delete/reopen/
resume/duplicate/search via the repository port.

## Agent

`Agent { projectId?, name, role, instructions, modelId?, tools[] (each with a
permission), maxSteps }`, `AgentRun { status
(idle/queued/running/awaiting-approval/completed/failed/cancelled),
currentStep, input, output?, error? }`.

## AI

`Provider { kind, baseUrl?, enabled }`, `Model { host (cloud/local),
capabilities { tools, streaming, vision, maxContextTokens, maxOutputTokens },
pricing? }`, `ChatRequest/ChatResponse { content, toolCalls, usage,
latencyMs }`, streaming chunks.

## Permission

16 canonical permissions (`READ_FILE … SYSTEM_ACCESS`), levels
(allow/require-approval/deny), `Policy { projectId?, agentId?, defaultLevel,
rules }`, `PermissionRequest { permission, action, target?, reason?, status
(pending/approved/rejected/expired) }`.

## Change

`Patch { targetPath, expectedHash? (optimistic concurrency), oldText?,
newText, diff?, risk, status
(proposed/approved/rejected/applied/failed/rolled-back), validation? }`,
`Snapshot { label, operation, files[] { path, hash, size } }`, `ActionPlan
{ steps[] (read/analyze/patch/execute/snapshot/report), status }`.

## Tasks & events

`TaskRecord { type, title, status
(queued/running/paused/completed/failed/cancelled), progress 0..1, priority,
cancellable, cancelRequested, error?, result? }`. 23 typed `AppEvent`s plus
append-only `AuditEvent { category, action, actor, target?, metadata }`.
