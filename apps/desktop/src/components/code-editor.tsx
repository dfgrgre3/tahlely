import { Suspense, lazy, useEffect, useState } from 'react';
import type { OnChange } from '@monaco-editor/react';

const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((module) => ({ default: module.default })),
);

function languageForFile(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'ts':
    case 'tsx':
    case 'mts':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'json':
      return 'json';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    case 'md':
      return 'markdown';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'toml':
      return 'ini';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'sql':
      return 'sql';
    case 'sh':
      return 'shell';
    default:
      return 'plaintext';
  }
}

/**
 * Editor abstraction. Monaco loads lazily (CDN) for full fidelity; when
 * offline or blocked, a plain textarea keeps editing functional. Callers
 * depend on this component, never on Monaco directly — the bundled-worker
 * migration (ADR-006) stays behind this boundary.
 */
export function CodeEditor({
  path,
  value,
  onChange,
  readOnly,
}: {
  path: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}) {
  const [monacoReady, setMonacoReady] = useState(false);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      if (live) setMonacoReady(false);
    }, 8000);
    import('@monaco-editor/react')
      .then(() => {
        if (live) {
          clearTimeout(timer);
          setMonacoReady(true);
        }
      })
      .catch(() => {
        if (live) {
          clearTimeout(timer);
          setMonacoReady(false);
        }
      });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  if (!monacoReady) {
    return (
      <textarea
        className="editor-fallback"
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  }

  const handleChange: OnChange = (next) => {
    onChange?.(next ?? '');
  };

  return (
    <Suspense
      fallback={<textarea className="editor-fallback" value={value} readOnly spellCheck={false} />}
    >
      <MonacoEditor
        height="100%"
        path={path}
        language={languageForFile(path)}
        value={value}
        theme="vs-dark"
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          renderWhitespace: 'selection',
        }}
        onChange={handleChange}
      />
    </Suspense>
  );
}
