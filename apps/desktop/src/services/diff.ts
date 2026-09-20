export type DiffLineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

const MAX_DIFF_LINES = 2000;

/**
 * Minimal line diff (LCS with bounded input) for patch previews.
 * Large inputs degrade to a whole-file replace hunk rather than O(n*m).
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  if (oldLines.length * newLines.length > 250000 || oldLines.length > MAX_DIFF_LINES) {
    return [
      ...oldLines.map((text): DiffLine => ({ kind: 'del', text })),
      ...newLines.map((text): DiffLine => ({ kind: 'add', text })),
    ];
  }
  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        oldLines[i] === newLines[j]
          ? (table[(i + 1) * cols + (j + 1)] ?? 0) + 1
          : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + (j + 1)] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      out.push({ kind: 'context', text: oldLines[i] ?? '', oldLine: oldNo, newLine: newNo });
      i += 1;
      j += 1;
      oldNo += 1;
      newNo += 1;
    } else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + (j + 1)] ?? 0)) {
      out.push({ kind: 'del', text: oldLines[i] ?? '', oldLine: oldNo });
      i += 1;
      oldNo += 1;
    } else {
      out.push({ kind: 'add', text: newLines[j] ?? '', newLine: newNo });
      j += 1;
      newNo += 1;
    }
  }
  while (i < oldLines.length) {
    out.push({ kind: 'del', text: oldLines[i] ?? '', oldLine: oldNo });
    i += 1;
    oldNo += 1;
  }
  while (j < newLines.length) {
    out.push({ kind: 'add', text: newLines[j] ?? '', newLine: newNo });
    j += 1;
    newNo += 1;
  }
  return out;
}

/** Compact unified-style text stored on Patch.diff. */
export function formatDiff(path: string, lines: DiffLine[]): string {
  const body = lines
    .slice(0, 400)
    .map((line) => `${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}${line.text}`)
    .join('\n');
  return `--- ${path}\n+++ ${path}\n${body}`;
}
