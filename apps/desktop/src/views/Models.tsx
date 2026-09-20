import { useEffect, useState } from 'react';
import { isTauri, shellPing } from '../services/tauri-bridge.js';
import { addCustomProvider, listCustomProviders, testProvider } from '../services/bootstrap.js';
import type { CustomProviderRecord } from '../services/bootstrap.js';
import { Badge, Button, EmptyState, Input, Panel } from '../components/design-system.js';
import { newId } from '@tahlely/domain';

export function Models() {
  const [providers, setProviders] = useState<CustomProviderRecord[]>([]);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434/v1');
  const [model, setModel] = useState('');
  const [testing, setTesting] = useState<string>();
  const [testResult, setTestResult] = useState<string>();

  useEffect(() => {
    setProviders(listCustomProviders());
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

  return (
    <div>
      <div className="topbar">
        <h1>Models & Providers</h1>
      </div>
      <Panel title="Built-in">
        <div className="row">
          <Badge tone="low">mock</Badge>
          <div className="grow">
            <strong>Mock (offline)</strong>
            <div className="dim">
              Deterministic local provider. Powers tests, offline mode, and the Prompt-1 shell.
            </div>
          </div>
        </div>
      </Panel>
      <Panel title="Custom OpenAI-compatible endpoints">
        <p className="dim">
          Works with Ollama, LM Studio, OpenRouter, DeepSeek, and any /chat/completions endpoint.
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
