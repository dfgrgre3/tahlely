import { DEFAULT_ALLOWLIST } from '@tahlely/execution';
import { useAppStore } from '../store/app-store.js';
import { Badge, EmptyState, Panel, ProgressBar } from '../components/design-system.js';

/**
 * Terminal / operations surface (Prompt 1): background task observability and
 * the execution allowlist. Direct command execution from the UI arrives with
 * the Rust sidecar + approval flow in a later phase.
 */
export function Terminal() {
  const tasks = useAppStore((state) => state.tasks);
  const activity = useAppStore((state) => state.activity);
  const refreshTasks = useAppStore((state) => state.refreshTasks);

  return (
    <div>
      <div className="topbar">
        <h1>Terminal & Tasks</h1>
        <div className="spacer" />
        <button className="btn btn-secondary" onClick={refreshTasks}>
          Refresh
        </button>
      </div>
      <Panel title={`Background tasks (${tasks.length})`}>
        {tasks.length === 0 ? (
          <EmptyState title="No tasks yet" hint="Indexing and analysis runs appear here." />
        ) : (
          <div className="list">
            {tasks.slice(0, 30).map((task) => (
              <div className="row" key={task.id}>
                <Badge>{task.status}</Badge>
                <div className="grow">
                  <strong>{task.title}</strong>
                  <div className="dim">
                    {task.type} · {Math.round(task.progress * 100)}%
                    {task.error ? ` · error: ${task.error}` : ''}
                  </div>
                  {(task.status === 'running' || task.status === 'queued') && (
                    <ProgressBar value={task.progress} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Execution allowlist (UI cannot bypass)">
        <p className="dim">
          Commands execute without a shell, only when allowlisted, and only after approval. The
          interactive runner lands with the execution sidecar.
        </p>
        <div className="list">
          {DEFAULT_ALLOWLIST.map((entry) => (
            <div className="row" key={entry.command}>
              <Badge tone="low">{entry.command}</Badge>
              <div className="grow">
                <div className="dim">
                  {entry.subcommands.length > 0
                    ? `subcommands: ${entry.subcommands.join(', ')}`
                    : 'any args (no shell metacharacters)'}
                </div>
                <div className="dim">{entry.description}</div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Event log">
        {activity.length === 0 ? (
          <EmptyState title="No events yet" />
        ) : (
          <div className="log">{activity.slice(-50).join('\n')}</div>
        )}
      </Panel>
    </div>
  );
}
