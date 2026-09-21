import { useEffect, useState } from 'react';
import { isTauri, shellPing } from '../services/tauri-bridge.js';
import {
  PROVIDER_PRESETS,
  getActiveModel,
  getProviderKey,
  hasProviderKey,
  isAutoLoaded,
  seedDevKeys,
  seedPresetProviders,
  setActiveModel,
  setProviderKey,
  testPresetProvider,
} from '../services/providers.js';
import {
  addCustomProvider,
  listCustomProviders,
  testProvider,
} from '../services/bootstrap.js';
import type { CustomProviderRecord } from '../services/bootstrap.js';
import { Badge, Button, EmptyState, Input, PageHeader, Panel, SearchInput } from '../components/design-system.js';
import { newId } from '@tahlely/domain';

export function Models() {
  const [providers, setProviders] = useState<CustomProviderRecord[]>([]);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434/v1');
  const [model, setModel] = useState('');
  const [testing, setTesting] = useState<string>();
  const [testResult, setTestResult] = useState<string>();
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string>(() => getActiveModel());
  const [providerQuery, setProviderQuery] = useState('');
  const visiblePresets = PROVIDER_PRESETS.filter((p) =>
    !providerQuery.trim() ||
    `${p.name} ${p.id} ${p.baseUrl}`.toLowerCase().includes(providerQuery.trim().toLowerCase()),
  );

  useEffect(() => {
    setProviders(listCustomProviders());
    const auto = seedDevKeys();
    seedPresetProviders();
    // First run with keys available: default to the verified Atria preset.
    try {
      if (!localStorage.getItem('tahlely.v1.active-model') && auto.includes('atria')) {
        setActiveModel('atria/Atria-Dawn-Preview');
        setActive('atria/Atria-Dawn-Preview');
      }
    } catch {
      // ignore
    }
    const initial: Record<string, string> = {};
    for (const preset of PROVIDER_PRESETS) {
      if (hasProviderKey(preset.id)) initial[preset.id] = '•••••• (saved this session)';
    }
    setKeys(initial);
  }, []);

  const add = () => {
    if (!name.trim() || !baseUrl.trim()) return;
    const record: CustomProviderRecord = {
      id: `custom_${newId('provider').slice(-8)}`,
      name: name.trim(),
      baseUrl: baseUrl.trim().replace(/\/+$/, ''),
      defaultModel: model.trim(),
    };
    setProviders(addCustomProvider(record));
    setName('');
    setModel('');
  };

  const test = async (record: CustomProviderRecord) => {
    setTesting(record.id);
    setTestResult(undefined);
    try {
      const models = await testProvider(record);
      setTestResult(
        `OK — ${models.length} models: ${models.slice(0, 5).join(', ') || '(none listed)'}`,
      );
    } catch (err) {
      setTestResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(undefined);
    }
  };

  const saveKey = (providerId: string, value: string) => {
    if (value.includes('••••')) return; // masked placeholder — keep existing
    setProviderKey(providerId, value);
    seedPresetProviders();
  };

  const testPreset = async (providerId: string) => {
    const key = getProviderKey(providerId);
    if (!key) {
      setTestResult(`Enter an API key for ${providerId} first.`);
      return;
    }
    setTesting(providerId);
    setTestResult(undefined);
    try {
      const reply = await testPresetProvider(providerId, key);
      setTestResult(`${providerId}: OK — ${reply}`);
    } catch (err) {
      setTestResult(`${providerId} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(undefined);
    }
  };

  const choose = (ref: string) => {
    setActiveModel(ref);
    setActive(ref);
  };

  return (
    <div>
      <PageHeader title="Models & Providers" subtitle={`Active model: ${active}`} />
      <Panel title="Built-in">
        <div className="row">
          <Badge tone="low">mock</Badge>
          <div className="grow">
            <strong>Mock (offline)</strong>
            <div className="dim">
              Deterministic local provider. Powers tests, offline mode, and the Prompt-1 shell.
            </div>
          </div>
          <Button variant={active === 'mock/mock-reviewer' ? 'primary' : 'secondary'} onClick={() => choose('mock/mock-reviewer')}>
            {active === 'mock/mock-reviewer' ? 'Active' : 'Use'}
          </Button>
        </div>
      </Panel>
      <Panel title="Cloud presets (OpenAI-compatible — keys stay in this session only)">
        <p className="dim">
          Paste a key per provider, press Save (session only, never persisted to disk), then Test.
          Pick any model as the active assistant model.
          Active: <strong>{active}</strong>
        </p>
        <div className="list">
          <SearchInput value={providerQuery} onChange={setProviderQuery} placeholder="Filter providers…" />
          {visiblePresets.map((preset) => (
            <div key={preset.id} style={{ borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
              <div className="row">
                <Badge>preset</Badge>
                <div className="grow">
                  <strong>{preset.name}</strong>
                  <div className="dim">
                    {preset.baseUrl} · {preset.envKey}
                    {isAutoLoaded(preset.id) ? ' · key auto-loaded from .env.local' : ''}
                  </div>
                </div>
                <Input
                  label="API key"
                  value={keys[preset.id] ?? ''}
                  onChange={(value) => setKeys((prev) => ({ ...prev, [preset.id]: value }))}
                  placeholder={preset.envKey}
                />
                <Button variant="secondary" onClick={() => saveKey(preset.id, keys[preset.id] ?? '')}>
                  Save
                </Button>
                <Button variant="secondary" onClick={() => void testPreset(preset.id)}>
                  {testing === preset.id ? 'Testing…' : 'Test'}
                </Button>
              </div>
              <div className="toolbar" style={{ marginTop: 8 }}>
                {preset.models.map((modelName) => {
                  const ref = `${preset.id}/${modelName}`;
                  return (
                    <Button
                      key={ref}
                      variant={active === ref ? 'primary' : 'secondary'}
                      onClick={() => choose(ref)}
                    >
                      {active === ref ? '● ' : ''}{modelName}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {testResult ? <p className="dim">{testResult}</p> : null}
      </Panel>
      <Panel title="Custom OpenAI-compatible endpoints">
        <p className="dim">
          Works with Ollama, LM Studio, and any /chat/completions endpoint.
          API keys are entered per session and never persisted — only the endpoint is stored.
        </p>
        <div className="toolbar">
          <Input label="Name" value={name} onChange={setName} placeholder="Local Ollama" />
          <Input
            label="Base URL"
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder="http://localhost:11434/v1"
          />
          <Input label="Default model" value={model} onChange={setModel} placeholder="llama3.1" />
          <Button onClick={add}>Add provider</Button>
        </div>
        {providers.length === 0 ? (
          <EmptyState
            title="No custom providers"
            hint="Ollama default: http://localhost:11434/v1"
          />
        ) : (
          <div className="list">
            {providers.map((provider) => (
              <div className="row" key={provider.id}>
                <Badge>custom</Badge>
                <div className="grow">
                  <strong>{provider.name}</strong>
                  <div className="dim">
                    {provider.baseUrl} · default: {provider.defaultModel || '(unset)'}
                  </div>
                  {testing === provider.id ? <div className="dim">Testing…</div> : null}
                </div>
                <Button variant="secondary" onClick={() => void test(provider)}>
                  Test
                </Button>
              </div>
            ))}
          </div>
        )}
        {testResult ? <p className="dim">{testResult}</p> : null}
      </Panel>
      <Panel title="Runtime">
        <p className="dim">
          Shell: {isTauri() ? 'Tauri desktop' : 'browser preview'} · Provider abstraction supports
          cloud, local, and hybrid models without app changes (see docs/ai-architecture.md).
        </p>
        <ShellStatus />
      </Panel>
    </div>
  );
}

function ShellStatus() {
  const [status, setStatus] = useState('checking…');
  useEffect(() => {
    shellPing()
      .then((pong) => setStatus(pong ?? 'browser preview (no shell)'))
      .catch(() => setStatus('unreachable'));
  }, []);
  return <p className="dim">Shell status: {status}</p>;
}
