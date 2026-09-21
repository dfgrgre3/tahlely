import { useEffect, useMemo, useState } from 'react';
import { diffRuns, listProfiles, scoreProject } from '@tahlely/analysis';
import type { AnalysisMode, FileNode, Finding } from '@tahlely/domain';
import { useAppStore } from '../store/app-store.js';
import { listProjectFiles, readProjectFile, requestFileWrite, services } from '../services/bootstrap.js';
import { CodeEditor } from '../components/code-editor.js';
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Panel,
  ProgressBar,
  SearchInput,
  Select,
  SeverityBadge,
  Tabs,
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

  const [profileId, setProfileId] = useState('comprehensive');
  const [mode, setMode] = useState<AnalysisMode>('tool-only');
  const [files, setFiles] = useState<FileNode[]>([]);
  const [fileQuery, setFileQuery] = useState('');
  const [severityTab, setSeverityTab] = useState<'all' | 'critical' | 'high' | 'medium' | 'low' | 'info'>('all');
  const [selectedPath, setSelectedPath] = useState<string>();
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saveNote, setSaveNote] = useState<string>();
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
      .then((text) => {
        setContent(text);
        setDraft(text);
        setEditing(false);
        setSaveNote(undefined);
      })
      .catch(() => {
        setContent('// Could not read this file (binary or unreadable).');
        setDraft('// Could not read this file (binary or unreadable).');
      });
  }, [activeProjectId, selectedPath]);

  const fileFindings = useMemo(() => {
    if (!selectedPath) return [];
    const selected = files.find((f) => f.path === selectedPath);
    return findings.filter((f) => f.path === selected?.relativePath);
  }, [findings, files, selectedPath]);

  const visibleFiles = useMemo(() => {
    const q = fileQuery.trim().toLowerCase();
    if (!q) return files.slice(0, 500);
    return files.filter((f) => f.relativePath.toLowerCase().includes(q)).slice(0, 500);
  }, [files, fileQuery]);

  const visibleFindings = useMemo(() => {
    const base = severityTab === 'all' ? findings : findings.filter((f) => f.severity === severityTab);
    return base.slice(0, 200);
  }, [findings, severityTab]);

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
      <PageHeader
        title={project.name}
        subtitle={`${project.rootPath} · comprehensive analysis covers every file`}
      />
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
          <SearchInput value={fileQuery} onChange={setFileQuery} placeholder="Filter files…" />
          <div className="file-list">
            {visibleFiles.map((file) => (
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
          <Panel
            title={selectedPath ?? 'Editor'}
            actions={
              selectedPath && activeProjectId ? (
                editing ? (
                  <>
                    <Button variant="secondary" onClick={() => {
                      setDraft(content);
                      setEditing(false);
                    }}>
                      Cancel
                    </Button>
                    <Button
                      disabled={busy || draft === content}
                      onClick={() => {
                        void requestFileWrite(
                          activeProjectId,
                          selectedPath,
                          draft,
                          'User edit from Workspace (pending approval)',
                        ).then(() => {
                          setEditing(false);
                          setSaveNote('Edit request sent to Approvals — it applies after you approve it.');
                        });
                      }}
                    >
                      Request save
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                )
              ) : undefined
            }
          >
            <div className="editor-wrap">
              <CodeEditor
                path={selectedPath ?? 'untitled.txt'}
                value={editing ? draft : content}
                readOnly={!editing}
                onChange={setDraft}
              />
            </div>
            {saveNote ? <p className="dim">{saveNote}</p> : null}
            {editing ? (
              <p className="dim">Editing requires approval — nothing is written until you approve it in Approvals.</p>
            ) : null}
          </Panel>
          <Panel title={`Problems (${fileFindings.length} in this file, ${findings.length} total)`}>
            {findings.length === 0 ? (
              <EmptyState title="No findings yet" hint="Run an analysis to populate problems." />
            ) : (
              <>
                <Tabs
                  tabs={[
                    { value: 'all', label: 'All', count: findings.length },
                    {
                      value: 'critical',
                      label: 'Critical',
                      count: findings.filter((f) => f.severity === 'critical').length,
                    },
                    {
                      value: 'high',
                      label: 'High',
                      count: findings.filter((f) => f.severity === 'high').length,
                    },
                    {
                      value: 'medium',
                      label: 'Medium',
                      count: findings.filter((f) => f.severity === 'medium').length,
                    },
                    {
                      value: 'low',
                      label: 'Low',
                      count: findings.filter((f) => f.severity === 'low').length,
                    },
                    {
                      value: 'info',
                      label: 'Info',
                      count: findings.filter((f) => f.severity === 'info').length,
                    },
                  ]}
                  active={severityTab}
                  onChange={setSeverityTab}
                />
                <div className="list">
                  {visibleFindings.map((finding) => (
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
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
