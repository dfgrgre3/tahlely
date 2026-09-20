import { useAppStore } from '../store/app-store.js';
import { Badge, Button, EmptyState, Panel } from '../components/design-system.js';

export function Approvals() {
  const approvals = useAppStore((state) => state.approvals);
  const decide = useAppStore((state) => state.decide);

  return (
    <div>
      <div className="topbar">
        <h1>Approvals</h1>
        <div className="spacer" />
        <span className="dim">
          Nothing executes without an explicit decision. Deny is always safe.
        </span>
      </div>
      <Panel title={`Pending requests (${approvals.length})`}>
        {approvals.length === 0 ? (
          <EmptyState
            title="No pending requests"
            hint="Agent write, execute, and network actions will appear here for review."
          />
        ) : (
          <div className="list">
            {approvals.map((request) => (
              <div className="row" key={request.id}>
                <Badge tone="medium">{request.permission}</Badge>
                <div className="grow">
                  <strong>{request.action}</strong>
                  <div className="dim">
                    {request.target ?? 'no target'} · {request.reason ?? 'no reason given'} ·{' '}
                    {request.createdAt}
                  </div>
                </div>
                <Button onClick={() => void decide(request.id, true)}>Approve</Button>
                <Button variant="danger" onClick={() => void decide(request.id, false)}>
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
