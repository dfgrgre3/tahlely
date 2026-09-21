import { useMemo, useState } from 'react';
import { render } from '@tahlely/reporting';
import { useAppStore } from '../store/app-store.js';
import { Button, CodeBlock, EmptyState, PageHeader, Panel, SearchInput } from '../components/design-system.js';

function downloadTextFile(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function Reports() {
  const reports = useAppStore((state) => state.reports);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) => `${r.title} ${r.generatedBy}`.toLowerCase().includes(q));
  }, [reports, query]);
  const selected = filtered.find((r) => r.id === selectedId) ?? filtered[filtered.length - 1];

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle={`${reports.length} generated artifacts — tool, AI, and snippet audits`}
        actions={
          selected ? (
            <Button
              variant="secondary"
              onClick={() => downloadTextFile(`${selected.title.slice(0, 60) || 'report'}.md`, render(selected))}
            >
              Download selected
            </Button>
          ) : undefined
        }
      />
      {reports.length === 0 ? (
        <Panel title="Reports">
          <EmptyState
            title="No reports yet"
            hint="Run an analysis in the Workspace, then choose Generate report."
          />
        </Panel>
      ) : (
        <div className="explorer">
          <Panel title={`Reports (${filtered.length})`}>
            <SearchInput value={query} onChange={setQuery} placeholder="Filter reports…" />
            <div className="file-list">
              {filtered.map((report) => (
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
