import { useEffect, useMemo, useState } from 'react';
import type { Agent, AgentRole, AgentRun } from '@tahlely/domain';
import { useAppStore } from '../store/app-store.js';
import {
  CUSTOM_AGENT_TOOLS,
  listAgentRuns,
  listCustomProviders,
  runAgentNow,
  saveCustomAgent,
} from '../services/bootstrap.js';
import { Badge, Button, EmptyState, Input, PageHeader, Panel, SearchInput, Select } from '../components/design-system.js';

const ROLES: AgentRole[] = [
  'reviewer',
  'analyst',
  'refactorer',
  'documenter',
  'tester',
  'planner',
  'custom',
];

export function Agents() {
  const agents = useAppStore((state) => state.agents);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const refresh = useAppStore((state) => state.refresh);

  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [goal, setGoal] = useState('Review the latest analysis findings and summarize top risks.');
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Agent>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [model, setModel] = useState('mock/mock-reviewer');
  const fleetResults = useAppStore((state) => state.fleetResults);
  const launchFleet = useAppStore((state) => state.launchFleet);

  const [cName, setCName] = useState('');
  const [cRole, setCRole] = useState<AgentRole>('custom');
  const [cInstructions, setCInstructions] = useState('');
  const [cTools, setCTools] = useState<Set<string>>(new Set(['read_file']));
  const [agentQuery, setAgentQuery] = useState('');
  const visibleAgents = agents.filter((a) =>
    !agentQuery.trim() ||
    `${a.name} ${a.role} ${a.instructions}`.toLowerCase().includes(agentQuery.trim().toLowerCase()),
  );

  const modelOptions = useMemo(
    () => [
      { value: 'mock/mock-reviewer', label: 'Mock (offline)' },
      ...listCustomProviders().map((p) => ({
        value: `${p.id}/${p.defaultModel}`,
        label: `${p.name} — ${p.defaultModel}`,
      })),
    ],
    [],
  );

  const reloadRuns = () => {
    if (activeProjectId) {
      listAgentRuns(activeProjectId)
        .then(setRuns)
        .catch(() => setRuns([]));
    }
  };

  useEffect(reloadRuns, [activeProjectId, agents.length]);

  const runOne = async (agent: Agent) => {
    if (!activeProjectId) return;
    setRunning((prev) => new Set(prev).add(agent.id));
    try {
      await runAgentNow(agent, activeProjectId, goal, {
        model,
        conversationId: activeConversationId,
      });
    } catch {
      // Failed/rejected runs surface with their error in the runs list.
    } finally {
      setRunning((prev) => {
        const next = new Set(prev);
        next.delete(agent.id);
        return next;
      });
      reloadRuns();
    }
  };

  const runSelected = () => {
    // Concurrent: every picked agent starts its own run with the chosen
    // model, bound to the active conversation; none blocks the others.
    for (const agent of agents.filter((a) => picked.has(a.id))) {
      void runOne(agent);
    }
  };

  const launchAll = () => {
    // The whole fleet (14 specialized agents) runs concurrently, each with
    // its own domain goal and the selected model.
    void launchFleet(model);
  };

  const createAgent = async () => {
    if (!cName.trim()) return;
    await saveCustomAgent({
      name: cName,
      role: cRole,
      instructions: cInstructions,
      toolNames: [...cTools],
    });
    setCName('');
    setCInstructions('');
    await refresh();
  };

  const toggle = (set: Set<string>, id: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  return (
    <div>
      <PageHeader
        title="Agents"
        subtitle={`${agents.length} specialized agents · concurrent runs behind the permission gate`}
        actions={
          <Button
            disabled={!activeProjectId || running.size > 0 || fleetResults.length > 0}
            title="Launch all 14 specialized agents concurrently on this project"
            onClick={launchAll}
          >
            {fleetResults.length > 0
              ? `Fleet done (${fleetResults.length})`
              : 'Launch fleet (14 agents)'}
          </Button>
        }
      />
      <div className="explorer">
        <div>
          <Panel
            title={`Agents (${visibleAgents.length}/${agents.length})`}
            actions={
              <Button
                disabled={!activeProjectId || picked.size === 0}
                title="Run every selected agent concurrently on this project"
                onClick={runSelected}
              >
                Run selected ({picked.size})
              </Button>
            }
          >
            <div className="toolbar">
              <SearchInput value={agentQuery} onChange={setAgentQuery} placeholder="Filter agents…" />
              <Input label="Goal" value={goal} onChange={setGoal} />
              <Select label="Model" value={model} onChange={setModel} options={modelOptions} />
            </div>
            <div className="list">
              {visibleAgents.map((agent) => (
                <div className="row" key={agent.id}>
                  <input
                    type="checkbox"
                    checked={picked.has(agent.id)}
                    onChange={() => toggle(picked, agent.id, setPicked)}
                    title="Select for concurrent run"
                  />
                  <div className="grow">
                    <strong>{agent.name}</strong> <Badge>{agent.role}</Badge>
                    <div className="dim">tools: {agent.tools.map((t) => t.name).join(', ')}</div>
                  </div>
                  <Button variant="secondary" onClick={() => setSelected(agent)}>
                    Inspect
                  </Button>
                  <Button
                    disabled={!activeProjectId || running.has(agent.id)}
                    onClick={() => void runOne(agent)}
                  >
                    {running.has(agent.id) ? 'Running…' : 'Run'}
                  </Button>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Build a custom agent">
            <div className="toolbar">
              <Input
                label="Name"
                value={cName}
                onChange={setCName}
                placeholder="Security sweeper"
              />
              <Select
                label="Role"
                value={cRole}
                onChange={(value) => setCRole(value as AgentRole)}
                options={ROLES.map((r) => ({ value: r, label: r }))}
              />
            </div>
            <label className="field">
              <span className="field-label">Instructions (its job — you decide)</span>
              <textarea
                className="input"
                rows={3}
                value={cInstructions}
                onChange={(event) => setCInstructions(event.target.value)}
                placeholder="What should this agent do, and what must it never do?"
              />
            </label>
            <div className="toolbar">
              {Object.entries(CUSTOM_AGENT_TOOLS).map(([name, tool]) => (
                <label key={name} className="dim">
                  <input
                    type="checkbox"
                    checked={cTools.has(name)}
                    onChange={() => toggle(cTools, name, setCTools)}
                  />{' '}
                  {name} ({tool.permission})
                </label>
              ))}
            </div>
            <Button variant="secondary" disabled={!cName.trim()} onClick={() => void createAgent()}>
              Create agent
            </Button>
          </Panel>
        </div>
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
              <EmptyState title="Select an agent" hint="Runs execute behind the permission gate." />
            )}
          </Panel>
          <Panel title={`Fleet results (${fleetResults.length})`}>
            {fleetResults.length === 0 ? (
              <EmptyState
                title="Fleet not launched"
                hint="Launch fleet runs 14 specialized agents concurrently on this project."
              />
            ) : (
              <div className="list">
                {fleetResults.map((result) => (
                  <div className="row" key={result.agentName}>
                    <Badge tone={result.status === 'completed' ? 'low' : 'high'}>
                      {result.status}
                    </Badge>
                    <div className="grow">
                      <strong>{result.agentName}</strong>
                      <div className="dim">{result.durationMs}ms</div>
                      {result.output ? <div>{result.output.slice(0, 200)}</div> : null}
                      {result.error ? <div className="dim">Error: {result.error}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
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
    </div>
  );
}
