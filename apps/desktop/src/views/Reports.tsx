import { useState } from 'react';
import { render } from '@tahlely/reporting';
import { useAppStore } from '../store/app-store.js';
import { CodeBlock, EmptyState, Panel } from '../components/design-system.js';

export function Reports() {
  const reports = useAppStore((state) => state.reports);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = reports.find((r) => r.id === selectedId) ?? reports[reports.length - 1];

  return (
    <div>
      <div className="topbar">
        <h1>Reports</h1>
      </div>
      {reports.length === 0 ? (
        <Panel title="Reports">
          <EmptyState
            title="No reports yet"
            hint="Run an analysis in the Workspace, then choose Generate report."
          />
        </Panel>
      ) : (
        <div className="explorer">
          <Panel title={`Reports (${reports.length})`}>
            <div className="file-list">
              {reports.map((report) => (
                <button
                  key={report.id}
                  className={`file-item${report.id === selected?.id ? ' active' : ''}`}
                  onClick={() => setSelectedId(report.id)}
                >
                  {report.title}
                </button>
              ))}
            </div>
          </Panel>
          <Panel title={selected?.title ?? 'Report'}>
            {selected ? <CodeBlock code={render(selected)} language={selected.format} /> : null}
          </Panel>
        </div>
      )}
    </div>
  );
}
