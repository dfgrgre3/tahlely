import { useEffect, useMemo, useState } from 'react';
import { render } from '@tahlely/reporting';
import type { FileNode } from '@tahlely/domain';
import { useAppStore } from '../store/app-store.js';
import { listProjectFiles, readProjectFile, services } from '../services/bootstrap.js';
import { annotateLines, buildFileReport, describeFilePurpose } from '../services/file-review.js';
import { FileTree } from '../components/file-tree.js';
import {
  Badge,
  Button,
  CodeBlock,
  EmptyState,
  Panel,
  SeverityBadge,
} from '../components/design-system.js';

export function FileReview() {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const findings = useAppStore((state) => state.findings);
  const analyses = useAppStore((state) => state.analyses);
  const refresh = useAppStore((state) => state.refresh);

  const [files, setFiles] = useState<FileNode[]>([]);
  const [selected, setSelected] = useState<FileNode>();
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!activeProjectId) return;
    listProjectFiles(activeProjectId)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [activeProjectId, analyses.length]);

  useEffect(() => {
    if (!activeProjectId || !selected) return;
    setSaved(false);
    readProjectFile(activeProjectId, selected.path)
      .then(setContent)
      .catch(() => setContent('// Could not read this file (binary or unreadable).'));
  }, [activeProjectId, selected]);

  const findingsByPath = useMemo(() => {
    const map = new Map<string, number>();
    for (const finding of findings) {
      if (finding.path) map.set(finding.path, (map.get(finding.path) ?? 0) + 1);
    }
    return map;
  }, [findings]);

  const annotations = useMemo(
    () => (selected ? annotateLines(content, findings, selected.relativePath) : []),
    [content, findings, selected],
  );
  const annotationsByLine = useMemo(() => {
    const map = new Map<number, typeof annotations>();
    for (const annotation of annotations) {
      const list = map.get(annotation.line) ?? [];
      list.push(annotation);
      map.set(annotation.line, list);
    }
    return map;
  }, [annotations]);

  const fileFindings = useMemo(
    () => (selected ? findings.filter((f) => f.path === selected.relativePath) : []),
    [findings, selected],
  );

  const report = useMemo(() => {
    if (!activeProjectId || !selected) return undefined;
    return buildFileReport({
      projectId: activeProjectId,
      conversationId: activeConversationId,
      relativePath: selected.relativePath,
      content,
      findings,
    });
  }, [activeProjectId, activeConversationId, selected, content, findings]);

  const saveReport = async () => {
    if (!report) return;
    await services.reports.saveReport(report);
    setSaved(true);
    await refresh();
  };

  if (!activeProjectId) {
    return (
      <Panel title="File Review">
        <EmptyState title="No project selected" hint="Upload a project folder from Projects." />
      </Panel>
    );
  }

  const lines = content.split('\n');

  return (
    <div>
      <div className="topbar">
        <h1>File Review</h1>
        <div className="spacer" />
        <span className="dim">
          {files.length} files · {findings.length} findings
        </span>
      </div>
      <div className="explorer">
        <Panel title={`Explorer (${files.length})`}>
          {files.length === 0 ? (
            <EmptyState title="No files indexed" hint="Upload a folder, then run an analysis." />
          ) : (
            <FileTree
              files={files}
              findingsByPath={findingsByPath}
              selectedPath={selected?.path}
              onSelect={setSelected}
            />
          )}
        </Panel>
        {!selected ? (
          <Panel title="File Review">
            <EmptyState
              title="Pick a file"
              hint="Click any file in the tree to open its 4 panes."
            />
          </Panel>
        ) : (
          <div className="panes">
            {/* Pane 1: original code + per-line comments + improved lines */}
            <Panel title={`1 · Code + improvements — ${selected.relativePath}`}>
              <div className="code">
                {lines.slice(0, 800).map((line, index) => {
                  const lineNo = index + 1;
                  const notes = annotationsByLine.get(lineNo) ?? [];
                  return (
                    <div key={lineNo}>
                      <div className="code-line">
                        <span className="line-no">{lineNo}</span>
                        <span className="line-text">{line || ' '}</span>
                      </div>
                      {notes.map((note, i) => (
                        <div key={i} className="anno">
                          <div className="anno-comment">
                            {note.severity ? <SeverityBadge severity={note.severity} /> : null}
                            <span>💡 {note.comment}</span>
                          </div>
                          {note.improved && note.improved !== line ? (
                            <div className="code-line anno-improved">
                              <span className="line-no">→</span>
                              <span className="line-text">{note.improved}</span>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </Panel>
            {/* Pane 2: error lines + how to fix them */}
            <Panel title={`2 · Errors & fixes (${fileFindings.length})`}>
              {fileFindings.length === 0 ? (
                <EmptyState title="No errors" hint="This file has no tool findings." />
              ) : (
                <div className="code">
                  {fileFindings.map((finding) => (
                    <div key={finding.id} className="anno">
                      <div className="code-line">
                        <span className="line-no">{finding.line ?? '–'}</span>
                        <span className="line-text">
                          {finding.line ? (lines[finding.line - 1] ?? '') : '(project-wide)'}
                        </span>
                      </div>
                      <div className="anno-comment">
                        <SeverityBadge severity={finding.severity} />
                        <span>
                          {'//'} Fix: {finding.recommendation ?? finding.description} (
                          {finding.ruleId})
                        </span>
                      </div>
                      {finding.suggestedFix ? (
                        <div className="code-line anno-improved">
                          <span className="line-no">→</span>
                          <span className="line-text">{finding.suggestedFix}</span>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            {/* Pane 3: comprehensive file report */}
            <Panel
              title="3 · File report"
              actions={
                <Button variant="secondary" onClick={() => void saveReport()} disabled={saved}>
                  {saved ? 'Saved ✓' : 'Save report'}
                </Button>
              }
            >
              {report ? <CodeBlock code={render(report)} language="markdown" /> : null}
            </Panel>
            {/* Pane 4: what the file does */}
            <Panel title="4 · What this file does">
              <CodeBlock
                code={describeFilePurpose(content, selected.relativePath)}
                language="markdown"
              />
              <p className="dim">
                <Badge>{selected.language}</Badge> {selected.size} bytes ·{' '}
                {annotations.filter((a) => a.source === 'heuristic').length} line suggestions
              </p>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
