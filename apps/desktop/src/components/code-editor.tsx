/**
 * Stable editor fallback used in this app.
 * Monaco is intentionally not mounted here because the bundled monaco package
 * can crash in browser builds with the "useCaseSensitiveFileNames" error.
 * A plain textarea keeps editing functional without breaking the UI.
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
  return (
    <textarea
      className="editor-fallback"
      value={value}
      readOnly={readOnly}
      spellCheck={false}
      onChange={(event) => onChange?.(event.target.value)}
      aria-label={path}
    />
  );
}
