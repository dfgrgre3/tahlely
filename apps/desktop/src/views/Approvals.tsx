import { useMemo, useState } from 'react';
import { useAppStore } from '../store/app-store.js';
import { Badge, Button, EmptyState, PageHeader, Panel, SearchInput, Tabs } from '../components/design-system.js';

export function Approvals() {
  const approvals = useAppStore((state) => state.approvals);
  const decide = useAppStore((state) => state.decide);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [permTab, setPermTab] = useState<string>('all');
  const perms = useMemo(() => [...new Set(approvals.map((r) => r.permission))], [approvals]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return approvals.filter((r) => {
      if (permTab !== 'all' && r.permission !== permTab) return false;
      if (!q) return true;
      return `${r.action} ${r.target ?? ''} ${r.reason ?? ''}`.toLowerCase().includes(q);
    });
  }, [approvals, permTab, query]);

  const decideAll = (approve: boolean) => {
    for (const r of visible) void decide(r.id, approve, notes[r.id]?.trim() || undefined);
  };

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="Nothing executes without an explicit decision. Deny is always safe."
        actions={
          visible.length > 0 ? (
            <>
              <Button variant="secondary" onClick={() => decideAll(true)}>
                Approve filtered ({visible.length})
              </Button>
              <Button variant="danger" onClick={() => decideAll(false)}>
                Reject filtered
              </Button>
            </>
          ) : undefined
        }
      />
      <Panel title={`Pending requests (${visible.length}/${approvals.length})`}>
        <SearchInput value={query} onChange={setQuery} placeholder="Filter by action, target, reason…" />
        <Tabs
          tabs={[{ value: 'all', label: 'All', count: approvals.length }, ...perms.map((p) => ({ value: p, label: p, count: approvals.filter((r) => r.permission === p).length }))]}
          active={permTab}
          onChange={setPermTab}
        />
        {visible.length === 0 ? (
          <EmptyState
            title="No pending requests"
            hint="Agent write, execute, and network actions will appear here for review."
          />
        ) : (
          <div className="list">
            {visible.map((request) => (
              <div className="row" key={request.id}>
                <Badge tone="medium">{request.permission}</Badge>
                <div className="grow">
                  <strong>{request.action}</strong>
                  <div className="dim">
                    {request.target ?? 'no target'} · {request.reason ?? 'no reason given'} ·{' '}
                    {request.createdAt}
                  </div>
                  <input
                    className="input"
                    placeholder="Note (optional) — attached to your decision"
                    value={notes[request.id] ?? ''}
                    onChange={(event) =>
                      setNotes((prev) => ({ ...prev, [request.id]: event.target.value }))
                    }
                  />
                </div>
                <Button
                  onClick={() =>
                    void decide(request.id, true, notes[request.id]?.trim() || undefined)
                  }
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  onClick={() =>
                    void decide(request.id, false, notes[request.id]?.trim() || undefined)
                  }
                >
                  Reject
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
