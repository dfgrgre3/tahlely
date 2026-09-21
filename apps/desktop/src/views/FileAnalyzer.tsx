import { useMemo, useRef, useState } from 'react';
import { render } from '@tahlely/reporting';
import type { Report } from '@tahlely/domain';
import { useAppStore } from '../store/app-store.js';
import type { SnippetAnalysisMode } from '../services/file-analyzer.js';
import {
  Badge,
  Button,
  CodeBlock,
  EmptyState,
  Input,
  Panel,
  Select,
} from '../components/design-system.js';

function downloadTextFile(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function sanitizeFileName(title: string): string {
  return `${
    title
      .replace(/[^\p{L}\p{N} _.-]/gu, '')
      .trim()
      .slice(0, 60) || 'report'
  }.md`;
}

const MODE_OPTIONS = [
  { value: 'tool', label: 'Tool only (offline analyzers)' },
  { value: 'ai', label: 'AI only' },
  { value: 'both', label: 'Both (tool + AI)' },
];

export function FileAnalyzer() {
  const reports = useAppStore((state) => state.reports);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const conversations = useAppStore((state) => state.conversations);
  const busy = useAppStore((state) => state.busy);
  const analyzeSnippet = useAppStore((state) => state.analyzeSnippet);
  const selectConversation = useAppStore((state) => state.selectConversation);

  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<SnippetAnalysisMode>('both');
  const [source, setSource] = useState<'paste' | 'upload' | 'url'>('paste');
  const [selectedId, setSelectedId] = useState<string>();
  const [localError, setLocalError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const conversationReports = useMemo(
    () =>
      reports.filter(
        (report) => !activeConversationId || report.conversationId === activeConversationId,
      ),
    [reports, activeConversationId],
  );
  const selected: Report | undefined =
    conversationReports.find((report) => report.id === selectedId) ??
    conversationReports[conversationReports.length - 1];

  const onUpload = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ''));
      setFileName(file.name);
      setSource('upload');
    };
    reader.readAsText(file);
  };

  const onFetchUrl = async () => {
    if (!url.trim()) return;
    setLocalError(undefined);
    try {
      const response = await fetch(url.trim());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setText(await response.text());
      setFileName(url.trim().split('/').pop() ?? '');
      setSource('url');
    } catch (error) {
      setLocalError(
        `Could not fetch URL (${error instanceof Error ? error.message : String(error)}). ` +
          'Some servers block browser fetches (CORS) — paste the text or upload the file instead.',
      );
    }
  };

  const onAnalyze = () => {
    setLocalError(undefined);
    void analyzeSnippet({ content: text, fileName: fileName || undefined, source, mode });
  };

  const downloadAll = () => {
    const combined = conversationReports.map((report) => render(report)).join('\n\n---\n\n');
    const conversation = conversations.find((c) => c.id === activeConversationId);
    downloadTextFile(
      `reports-${conversation?.title ?? activeConversationId ?? 'conversation'}.md`,
      combined,
    );
  };

  return (
    <div>
      <div className="topbar">
        <h1>File Analyzer</h1>
        <div className="spacer" />
        <Select
          value={activeConversationId ?? ''}
          onChange={(id) => void selectConversation(id)}
          options={conversations.map((c) => ({ value: c.id, label: c.title }))}
        />
      </div>
      {!activeProjectId ? (
        <Panel title="File Analyzer">
          <EmptyState
            title="No project selected"
            hint="Open or create a project first — every analysis belongs to a project conversation."
          />
        </Panel>
      ) : (
        <div className="explorer">
          <div>
            <Panel title="Input">
              <div className="toolbar">
                <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                  Upload file
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={(event) => onUpload(event.target.files)}
                />
                <Input value={url} onChange={setUrl} placeholder="https://…/file.ts" />
                <Button variant="secondary" onClick={() => void onFetchUrl()}>
                  Fetch URL
                </Button>
              </div>
              <Input
                value={fileName}
                onChange={(value) => {
                  setFileName(value);
                  if (text) setSource('paste');
                }}
                placeholder="File name (optional — e.g. auth.ts)"
                label="Name"
              />
              <label className="field">
                <span className="field-label">Code / text</span>
                <textarea
                  className="input"
                  rows={14}
                  value={text}
                  placeholder="Paste code or text here…"
                  onChange={(event) => {
                    setText(event.target.value);
                    setSource(fileName ? 'upload' : 'paste');
                  }}
                />
              </label>
              {localError ? <p className="error-text">{localError}</p> : null}
            </Panel>
            <Panel title="Analyze with">
              <div className="toolbar">
                <Select
                  value={mode}
                  onChange={(value) => setMode(value as SnippetAnalysisMode)}
                  options={MODE_OPTIONS}
                />
                <Button onClick={onAnalyze} disabled={busy || !text.trim()}>
                  {busy ? 'Analyzing…' : 'Analyze & generate report'}
                </Button>
              </div>
            </Panel>
            <Panel title={selected?.title ?? 'Report preview'}>
              {selected ? (
                <CodeBlock code={render(selected)} language="markdown" />
              ) : (
                <EmptyState
                  title="No report yet"
                  hint="Analyze a file or pasted text — the report appears here and in the sidebar."
                />
              )}
            </Panel>
          </div>
          <Panel
            title={`Conversation reports (${conversationReports.length})`}
            actions={
              conversationReports.length > 0 ? (
                <Button variant="secondary" onClick={downloadAll}>
                  Download all
                </Button>
              ) : undefined
            }
          >
            {conversationReports.length === 0 ? (
              <EmptyState title="Empty" hint="Reports for this conversation are listed here." />
            ) : (
              <div className="file-list">
                {conversationReports.map((report) => (
                  <div key={report.id} className="file-item-row">
                    <button
                      className={`file-item${report.id === selected?.id ? ' active' : ''}`}
                      onClick={() => setSelectedId(report.id)}
                    >
                      {report.title}
                    </button>
                    <Badge tone="neutral">{report.generatedBy}</Badge>
                    <Button
                      variant="ghost"
                      title="Download this report"
                      onClick={() =>
                        downloadTextFile(sanitizeFileName(report.title), render(report))
                      }
                    >
                      ⬇
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
