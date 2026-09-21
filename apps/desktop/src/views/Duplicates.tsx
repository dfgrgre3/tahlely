import { useMemo, useState } from 'react';
import type { FileNode } from '@tahlely/domain';
import { useAppStore } from '../store/app-store.js';
import { listProjectFiles, readProjectFile, requestFileDeletion } from '../services/bootstrap.js';
import type { DuplicateGroup } from '../services/duplicates.js';
import { findDuplicateGroups } from '../services/duplicates.js';
import { Badge, Button, EmptyState, PageHeader, Panel, SearchInput } from '../components/design-system.js';

const MAX_SCAN_FILES = 400;

export function Duplicates() {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const findings = useAppStore((state) => state.findings);
  const [groups, setGroups] = useState<DuplicateGroup[]>();
  const [scanning, setScanning] = useState(false);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const visibleGroups = useMemo(() => {
    if (!groups) return undefined;
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => `${g.reason} ${g.recommendedKeep} ${g.files.map((f) => f.path).join(' ')}`.toLowerCase().includes(q));
  }, [groups, query]);

  const scan = async () => {
    if (!activeProjectId) return;
    setScanning(true);
    setError(undefined);
    try {
      const indexed = (await listProjectFiles(activeProjectId)).slice(0, MAX_SCAN_FILES);
      const withContent: { node: FileNode; content: string }[] = [];
      for (const node of indexed) {
        if (node.binary || node.generated) continue;
        try {
          withContent.push({
            node,
            content: (await readProjectFile(activeProjectId, node.path)).slice(0, 100000),
          });
        } catch {
          // Unreadable files are skipped from duplicate detection.
        }
      }
      setGroups(findDuplicateGroups(withContent, findings));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  const requestDeletion = async (path: string, reason: string) => {
    if (!activeProjectId) return;
    await requestFileDeletion(activeProjectId, path, reason);
    setRequested((prev) => new Set(prev).add(path));
  };

  return (
    <div>
      <PageHeader
        title="Duplicate files"
        subtitle={groups ? `${groups.length} groups from content-hash scan` : 'Content-hash scan with keep/remove scoring'}
        actions={
          <Button onClick={() => void scan()} disabled={scanning || !activeProjectId}>
            {scanning ? 'Scanning…' : 'Scan for duplicates'}
          </Button>
        }
      />
      {error ? <p className="error-text">{error}</p> : null}
      {!visibleGroups ? (
        <Panel title="Duplicates">
          <EmptyState
            title="No scan yet"
            hint="Scan groups files that do the same job, scores them, and recommends what to keep."
          />
        </Panel>
      ) : visibleGroups.length === 0 ? (
        <Panel title="Duplicates">
          <EmptyState title="No duplicates found" hint="Every scanned file has a unique role." />
        </Panel>
      ) : (
        <>
          <Panel title="Filter groups">
            <SearchInput value={query} onChange={setQuery} placeholder="Filter by path or reason…" />
          </Panel>
          {visibleGroups.map((group) => (
            <Panel key={group.id} title={`Group — ${group.reason}`}>
              <p className="dim">
                Recommendation: keep <strong>{group.recommendedKeep}</strong>
                {group.recommendedRemove.length > 0
                  ? ` · remove ${group.recommendedRemove.join(', ')}`
                  : ''}
              </p>
              <div className="list">
                {group.files.map((file) => {
                  const keep = file.path === group.recommendedKeep;
                  return (
                    <div className="row" key={file.path}>
                      <Badge tone={keep ? 'low' : 'high'}>{keep ? 'KEEP' : 'REMOVE?'}</Badge>
                      <div className="grow">
                        <strong>{file.path}</strong>
                        <div className="dim">
                          score {file.score.toFixed(1)} · {file.lines} lines · {file.exports} exports
                          · {file.findings} findings
                        </div>
                        <div className="dim">✔ {file.pros.join(' · ') || '—'}</div>
                        <div className="dim">✖ {file.cons.join(' · ') || '—'}</div>
                      </div>
                      {!keep ? (
                        <Button
                          variant="danger"
                          disabled={requested.has(file.path)}
                          title="Sends a DELETE_FILE request to Approvals — the file is deleted only if you approve"
                          onClick={() =>
                            void requestDeletion(
                              file.path,
                              `Duplicate of ${group.recommendedKeep} (${group.reason})`,
                            )
                          }
                        >
                          {requested.has(file.path) ? 'Requested ✓' : 'Request deletion'}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Panel>
          ))}
        </>
      )}
    </div>
  );
}
