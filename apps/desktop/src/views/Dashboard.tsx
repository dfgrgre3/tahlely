import { Link } from 'react-router-dom';
import { useAppStore } from '../store/app-store.js';
import { Button, EmptyState, Grid, Panel, Stat } from '../components/design-system.js';

export function Dashboard() {
  const projects = useAppStore((state) => state.projects);
  const findings = useAppStore((state) => state.findings);
  const approvals = useAppStore((state) => state.approvals);
  const tasks = useAppStore((state) => state.tasks);
  const activity = useAppStore((state) => state.activity);
  const openDemo = useAppStore((state) => state.openDemo);

  const critical = findings.filter((f) => f.severity === 'critical').length;
  const high = findings.filter((f) => f.severity === 'high').length;
  const running = tasks.filter((t) => t.status === 'running' || t.status === 'queued').length;

  return (
    <div>
      <div className="topbar">
        <h1>Dashboard</h1>
        <div className="spacer" />
        {projects.length === 0 ? (
          <Button onClick={() => void openDemo()}>Load demo project</Button>
        ) : null}
      </div>
      {projects.length === 0 ? (
        <Panel title="Welcome to Tahlely">
          <EmptyState
            title="No project open yet"
            hint="Open a folder from the Projects page, or load the bundled demo to exercise indexing, analysis, and reporting end to end."
          />
        </Panel>
      ) : null}
      <Grid>
        <Stat label="Projects" value={projects.length} />
        <Stat label="Findings (active project)" value={findings.length} />
        <Stat label="Critical + High" value={critical + high} />
        <Stat label="Pending approvals" value={approvals.length} />
        <Stat label="Background tasks active" value={running} />
      </Grid>
      <Panel title="Recent activity">
        {activity.length === 0 ? (
          <EmptyState
            title="Nothing yet"
            hint="Open a project or run an analysis to populate the event feed."
          />
        ) : (
          <div className="log">{activity.slice(-30).join('\n')}</div>
        )}
      </Panel>
      <Panel title="Modules">
        <div className="list">
          {(
            [
              ['Projects', '/projects', 'Open folders, inspect discovery, manage workspace'],
              ['Workspace', '/workspace', 'Explorer, editor, analysis runs, problems'],
              ['Reports', '/reports', 'Generated analysis reports'],
              ['Conversations', '/conversations', 'Persistent project workspaces'],
              ['Agents', '/agents', 'Review agents with permission gates'],
              ['Approvals', '/approvals', 'Human decisions on sensitive actions'],
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
