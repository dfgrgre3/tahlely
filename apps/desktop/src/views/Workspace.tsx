import { useEffect, useMemo, useState } from 'react';
import { diffRuns, listProfiles, scoreProject } from '@tahlely/analysis';
import type { AnalysisMode, FileNode, Finding } from '@tahlely/domain';
import { useAppStore } from '../store/app-store.js';
import { listProjectFiles, readProjectFile, services } from '../services/bootstrap.js';
import { CodeEditor } from '../components/code-editor.js';
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  ProgressBar,
  Select,
  SeverityBadge,
} from '../components/design-system.js';

const MODES: { value: AnalysisMode; label: string }[] = [
  { value: 'tool-only', label: 'Tool only (deterministic, offline)' },
  { value: 'hybrid', label: 'Hybrid (tools + AI reasoning)' },
  { value: 'ai-only', label: 'AI only (context review)' },
];

export function Workspace() {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const projects = useAppStore((state) => state.projects);
  const findings = useAppStore((state) => state.findings);
  const analyses = useAppStore((state) => state.analyses);
  const tasks = useAppStore((state) => state.tasks);
  const busy = useAppStore((state) => state.busy);
  const runAnalysis = useAppStore((state) => state.runAnalysis);
  const generateReport = useAppStore((state) => state.generateReport);
  const generateAiReport = useAppStore((state) => state.generateAiReport);
  const generateToolReport = useAppStore((state) => state.generateToolReport);

  const [profileId, setProfileId] = useState('standard');
  const [mode, setMode] = useState<AnalysisMode>('tool-only');
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [content, setContent] = useState('');
  const [previousFindings, setPreviousFindings] = useState<Finding[] | undefined>();

  const project = projects.find((p) => p.id === activeProjectId);
  const latestAnalysis = analyses[analyses.length - 1];
  const activeTask = tasks.find((t) => t.status === 'running' || t.status === 'queued');

  useEffect(() => {
    if (!activeProjectId) return;
    listProjectFiles(activeProjectId)
      .then((indexed) => {
        setFiles(indexed);
        if (!selectedPath && indexed[0]) setSelectedPath(indexed[0].path);
      })
      .catch(() => setFiles([]));
  }, [activeProjectId, analyses.length]);

  useEffect(() => {
    if (!activeProjectId || !selectedPath) return;
    readProjectFile(activeProjectId, selectedPath)
      .then(setContent)
      .catch(() => setContent('// Could not read this file (binary or unreadable).'));
  }, [activeProjectId, selectedPath]);

  const fileFindings = useMemo(() => {
    if (!selectedPath) return [];
    const selected = files.find((f) => f.path === selectedPath);
    return findings.filter((f) => f.path === selected?.relativePath);
  }, [findings, files, selectedPath]);

  // Run comparison: previous completed run vs the latest one.
  useEffect(() => {
    if (!activeProjectId || analyses.length < 2) {
      setPreviousFindings(undefined);
      return;
    }
    const previous = analyses[analyses.length - 2];
    if (!previous) return;
    services.analyses
      .listFindings(activeProjectId, previous.id)
      .then(setPreviousFindings)
      .catch(() => setPreviousFindings(undefined));
  }, [activeProjectId, analyses.length]);

  const runDiff = useMemo(() => {
    if (!previousFindings) return undefined;
    return diffRuns(previousFindings, findings);
  }, [previousFindings, findings]);

  const quality = useMemo(
    () => scoreProject(findings, latestAnalysis?.summary),
    [findings, latestAnalysis],
  );

  if (!project) {
    return (
      <Panel title="Workspace">
        <EmptyState title="No project selected" hint="Open a project first." />
      </Panel>
    );
  }

  return (
    <div>
      <div className="topbar">
        <h1>{project.name}</h1>
        <div className="spacer" />
        <span className="dim">{project.rootPath}</span>
      </div>
      <Panel
        title="Analysis"
        actions={
          latestAnalysis ? (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void generateReport(latestAnalysis.id, `${project.name} report`)}
              >
                Generate report
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                title="Comprehensive report built entirely by the tool's analyzers — every file with exact error lines and fixes. No AI."
                onClick={() => void generateToolReport(latestAnalysis.id)}
              >
                Strict tool report
              </Button>
              <Button
                disabled={busy}
                title="Findings + code excerpts are sent to the selected model to write the full report"
                onClick={() => void generateAiReport(latestAnalysis.id)}
              >
                {busy ? 'Working…' : 'Generate AI report'}
              </Button>
            </>
          ) : undefined
        }
      >
        <div className="toolbar">
          <Select
            label="Profile"
            value={profileId}
            onChange={setProfileId}
            options={listProfiles().map((p) => ({ value: p.id, label: p.label }))}
          />
          <Select
            label="Mode"
            value={mode}
            onChange={(value) => setMode(value as AnalysisMode)}
            options={MODES}
          />
          <Button disabled={busy} onClick={() => void runAnalysis(profileId, mode)}>
            Run analysis
          </Button>
        </div>
        {activeTask ? (
          <div>
            <div className="dim">
              {activeTask.title} — {activeTask.status} ({Math.round(activeTask.progress * 100)}%)
            </div>
            <ProgressBar value={activeTask.progress} />
          </div>
        ) : null}
        {latestAnalysis?.summary ? (
          <p className="dim">
            Last run: {latestAnalysis.summary.findingsCreated} findings across{' '}
            {latestAnalysis.summary.filesScanned} files in {latestAnalysis.summary.durationMs}ms
            (mode: {latestAnalysis.mode}, profile: {latestAnalysis.profileId}).
          </p>
        ) : null}
        {findings.length > 0 || latestAnalysis ? (
          <p className="dim">
            Quality:{' '}
            <Badge tone={quality.score >= 75 ? 'low' : quality.score >= 40 ? 'medium' : 'high'}>
              {quality.grade} ({quality.score}/100)
            </Badge>{' '}
            {quality.criticalOpen > 0 ? (
              <Badge tone="high">{quality.criticalOpen} critical</Badge>
            ) : null}{' '}
            {quality.hygieneIssues > 0 ? <Badge>{quality.hygieneIssues} hygiene</Badge> : null}
            {quality.topRules.length > 0 ? ` · top rule: ${quality.topRules[0]?.ruleId}` : ''}
          </p>
        ) : null}
        {runDiff ? (
          <p className="dim">
            Since the previous run: <Badge tone="high">+{runDiff.introduced.length} new</Badge>{' '}
            <Badge tone="low">−{runDiff.resolved.length} fixed</Badge>{' '}
            <Badge>{runDiff.persisting.length} still open</Badge>
          </p>
        ) : null}
      </Panel>
      <div className="explorer">
        <Panel title={`Explorer (${files.length})`}>
          <div className="file-list">
            {files.slice(0, 500).map((file) => (
              <button
                key={file.id}
                className={`file-item${file.path === selectedPath ? ' active' : ''}`}
                onClick={() => setSelectedPath(file.path)}
              >
                {file.relativePath}
              </button>
            ))}
          </div>
        </Panel>
        <div>
          <Panel title={selectedPath ?? 'Editor'}>
            <div className="editor-wrap">
              <CodeEditor path={selectedPath ?? 'untitled.txt'} value={content} readOnly />
            </div>
          </Panel>
          <Panel title={`Problems (${fileFindings.length} in this file, ${findings.length} total)`}>
            {findings.length === 0 ? (
              <EmptyState title="No findings yet" hint="Run an analysis to populate problems." />
            ) : (
              <div className="list">
                {findings.slice(0, 100).map((finding) => (
                  <div className="row" key={finding.id}>
                    <SeverityBadge severity={finding.severity} />
                    <div className="grow">
                      <strong>{finding.title}</strong>
                      <div className="dim">
                        {finding.path}
                        {finding.line ? `:${finding.line}` : ''} · {finding.ruleId} · source:{' '}
                        {finding.source}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
