import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { scoreProject } from '@tahlely/analysis';
import { useAppStore } from '../store/app-store.js';
import { Button, EmptyState, Grid, PageHeader, Panel, Stat } from '../components/design-system.js';

export function Dashboard() {
  const projects = useAppStore((state) => state.projects);
  const findings = useAppStore((state) => state.findings);
  const analyses = useAppStore((state) => state.analyses);
  const approvals = useAppStore((state) => state.approvals);
  const tasks = useAppStore((state) => state.tasks);
  const reports = useAppStore((state) => state.reports);
  const activity = useAppStore((state) => state.activity);
  const busy = useAppStore((state) => state.busy);
  const openDemo = useAppStore((state) => state.openDemo);
  const runAnalysis = useAppStore((state) => state.runAnalysis);
  const activeProjectId = useAppStore((state) => state.activeProjectId);

  const critical = findings.filter((f) => f.severity === 'critical').length;
  const high = findings.filter((f) => f.severity === 'high').length;
  const running = tasks.filter((t) => t.status === 'running' || t.status === 'queued').length;
  const latest = analyses[analyses.length - 1];
  const quality = useMemo(() => scoreProject(findings, latest?.summary), [findings, latest]);
  const bySeverity = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const f of findings) acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, [findings]);

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Engineering workspace at a glance — comprehensive analysis by default"
        actions={
          <>
            {projects.length === 0 ? (
              <Button onClick={() => void openDemo()}>Load sample project</Button>
            ) : null}
            {activeProjectId ? (
              <Button
                variant="secondary"
                disabled={busy}
                title="Run every analyzer over every file — no fixed pattern"
                onClick={() => void runAnalysis('comprehensive', 'tool-only')}
              >
                {busy ? 'Analyzing…' : 'Run comprehensive analysis'}
              </Button>
            ) : null}
          </>
        }
      />
      {projects.length === 0 ? (
        <Panel title="Welcome to Tahlely">
          <EmptyState
            title="Start with a project"
            hint="Open a folder from the Projects view, or load the bundled demo to explore indexing, analysis, and reporting end to end."
          />
        </Panel>
      ) : null}
      <Grid>
        <Stat label="Projects" value={projects.length} />
        <Stat label="Active findings" value={findings.length} />
        <Stat label="Critical + high" value={critical + high} />
        <Stat label="Quality score" value={`${quality.score}/100`} hint={`grade ${quality.grade}`} />
        <Stat label="Pending approvals" value={approvals.length} />
        <Stat label="Reports" value={reports.length} />
        <Stat label="Background tasks" value={running} />
        <Stat
          label="Severity mix"
          value={findings.length === 0 ? '—' : `${bySeverity['critical'] ?? 0}C · ${bySeverity['high'] ?? 0}H · ${bySeverity['medium'] ?? 0}M`}
          hint={latest ? `profile ${latest.profileId} · ${latest.summary?.filesScanned ?? 0} files` : 'no run yet'}
        />
      </Grid>
      <Panel title="Recent activity stream">
        {activity.length === 0 ? (
          <EmptyState
            title="No activity yet"
            hint="Open a project or launch an analysis to populate the event feed."
          />
        ) : (
          <div className="log">{activity.slice(-30).join('\n')}</div>
        )}
      </Panel>
      <Panel title="Workspace modules">
        <div className="list">
          {(
            [
              ['Projects', '/projects', 'Open folders, track discovery, and manage your workspace'],
              ['Workspace', '/workspace', 'Browse files, inspect code, and review active runs'],
              ['Reports', '/reports', 'View generated insights and summary artifacts'],
              ['Conversations', '/conversations', 'Keep project context and team discussions in one place'],
              ['Agents', '/agents', 'Review specialized agents and permission gating'],
              ['Approvals', '/approvals', 'Confirm high-impact actions before they run'],
            ] as [string, string, string][]
          ).map(([label, to, hint]) => (
            <div className="row" key={to}>
              <div className="grow">
                <Link to={to}>{label}</Link>
                <div className="dim">{hint}</div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
