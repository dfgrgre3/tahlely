import { useEffect, useState } from 'react';
import type { Agent, AgentRun } from '@tahlely/domain';
import { useAppStore } from '../store/app-store.js';
import { listAgentRuns, runAgentNow } from '../services/bootstrap.js';
import { Badge, Button, EmptyState, Input, Panel } from '../components/design-system.js';

export function Agents() {
  const agents = useAppStore((state) => state.agents);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [goal, setGoal] = useState(
    'Review the latest analysis findings and summarize the top risks.',
  );
  const [runningId, setRunningId] = useState<string>();
  const [selected, setSelected] = useState<Agent>();

  useEffect(() => {
    if (activeProjectId) {
      listAgentRuns(activeProjectId)
        .then(setRuns)
        .catch(() => setRuns([]));
    }
  }, [activeProjectId, agents.length]);

  const run = async (agent: Agent) => {
    if (!activeProjectId) return;
    setRunningId(agent.id);
    try {
      const finished = await runAgentNow(agent, activeProjectId, goal);
      setRuns((previous) => [...previous, finished]);
    } catch {
      if (activeProjectId) {
        listAgentRuns(activeProjectId)
          .then(setRuns)
          .catch(() => undefined);
      }
    } finally {
      setRunningId(undefined);
    }
  };

  return (
    <div>
      <div className="topbar">
        <h1>Agents</h1>
      </div>
      {agents.length === 0 ? (
        <Panel title="Agents">
          <EmptyState title="No agents" hint="Built-in agents seed automatically on launch." />
        </Panel>
      ) : (
        <div className="explorer">
          <Panel title={`Agents (${agents.length})`}>
            <div className="list">
              {agents.map((agent) => (
                <div className="row" key={agent.id}>
                  <div className="grow">
                    <strong>{agent.name}</strong>
                    <div className="dim">
                      {agent.role} · tools: {agent.tools.map((t) => t.name).join(', ')}
                    </div>
                  </div>
                  <Button variant="secondary" onClick={() => setSelected(agent)}>
                    Inspect
                  </Button>
                  <Button
                    disabled={!activeProjectId || runningId === agent.id}
                    onClick={() => void run(agent)}
                  >
                    {runningId === agent.id ? 'Running…' : 'Run'}
                  </Button>
                </div>
              ))}
            </div>
            <div className="toolbar" style={{ marginTop: 12 }}>
              <Input label="Goal for the next run" value={goal} onChange={setGoal} />
            </div>
          </Panel>
          <div>
            <Panel title="Agent detail">
              {selected ? (
                <div>
                  <p>
                    <strong>{selected.name}</strong> <Badge>{selected.role}</Badge>
                  </p>
                  <p className="dim">{selected.instructions}</p>
                  <p className="dim">Max steps: {selected.maxSteps}</p>
                </div>
              ) : (
                <EmptyState title="Select an agent" hint="Runs are read-only in this phase." />
              )}
            </Panel>
            <Panel title={`Runs (${runs.length})`}>
              {runs.length === 0 ? (
                <EmptyState title="No runs yet" />
              ) : (
                <div className="list">
                  {runs
                    .slice(-10)
                    .reverse()
                    .map((item) => (
                      <div className="row" key={item.id}>
                        <Badge tone={item.status === 'completed' ? 'low' : 'high'}>
                          {item.status}
                        </Badge>
                        <div className="grow">
                          <div className="dim">{item.input.slice(0, 120)}</div>
                          {item.output ? <div>{item.output.slice(0, 240)}</div> : null}
                          {item.error ? <div className="dim">Error: {item.error}</div> : null}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
