import { describeConfig, defaultConfig } from '@tahlely/infrastructure';
import { useAppStore } from '../store/app-store.js';
import { isTauri } from '../services/tauri-bridge.js';
import { Button, CodeBlock, PageHeader, Panel, Tabs } from '../components/design-system.js';
import { useState } from 'react';

export function Settings() {
  const activity = useAppStore((state) => state.activity);
  const [tab, setTab] = useState<'runtime' | 'config' | 'diagnostics'>('runtime');

  const clearLocalData = () => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith('tahlely.')) keys.push(key);
      }
      for (const key of keys) localStorage.removeItem(key);
    } catch {
      // Storage may be unavailable; nothing to clear.
    }
    window.location.reload();
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Runtime, configuration, and diagnostics" />
      <Tabs
        tabs={[
          { value: 'runtime', label: 'Runtime' },
          { value: 'config', label: 'Configuration' },
          { value: 'diagnostics', label: `Diagnostics (${activity.length})` },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'runtime' ? (
        <Panel title="Runtime">
          <p className="dim">
            Environment: {isTauri() ? 'Tauri desktop shell' : 'browser preview'} · Projects,
            conversations, and approvals persist in local storage in this phase; full SQLite history
            lands with the persistence migration (ADR-004).
          </p>
          <Button variant="danger" onClick={clearLocalData}>
            Clear local data & reload
          </Button>
        </Panel>
      ) : null}
      {tab === 'config' ? (
        <Panel title="Effective configuration (secrets never shown)">
          <CodeBlock
            code={JSON.stringify(
              describeConfig(defaultConfig(isTauri() ? '<app-data>' : '<browser-storage>')),
              null,
              2,
            )}
            language="json"
          />
        </Panel>
      ) : null}
      {tab === 'diagnostics' ? (
        <Panel title={`Diagnostics (${activity.length} events)`}>
          <div className="log">{activity.slice(-100).join('\n') || '(no events yet)'}</div>
        </Panel>
      ) : null}
    </div>
  );
}
