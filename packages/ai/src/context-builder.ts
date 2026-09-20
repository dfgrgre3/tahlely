import { redactSecrets } from '@tahlely/security';
import type { ChatMessage } from '@tahlely/domain';

export interface ContextFile {
  path: string;
  content: string;
}

export interface ContextBudget {
  maxChars: number;
  maxFiles: number;
}

/**
 * Budgeted AI context assembly. Never uploads whole projects silently:
 * callers pass an explicit file list (retrieval results, pinned files), the
 * builder truncates per-file and overall, redacts secrets, and reports what
 * was dropped so the UI can show it. This is the data-ownership boundary.
 */
export interface AssembledContext {
  messages: ChatMessage[];
  includedFiles: string[];
  droppedFiles: string[];
  redacted: boolean;
  totalChars: number;
}

export function buildContext(
  systemPrompt: string,
  userPrompt: string,
  files: ContextFile[],
  budget: ContextBudget,
): AssembledContext {
  const perFile = Math.max(500, Math.floor(budget.maxChars / Math.max(1, budget.maxFiles)));
  const includedFiles: string[] = [];
  const droppedFiles: string[] = [];
  const parts: string[] = [];
  let totalChars = systemPrompt.length + userPrompt.length;
  let redacted = false;

  for (const file of files.slice(0, budget.maxFiles)) {
    const cleaned = redactSecrets(file.content);
    if (cleaned !== file.content) redacted = true;
    let snippet = cleaned;
    let truncated = false;
    if (snippet.length > perFile) {
      snippet = `${snippet.slice(0, perFile)}\n…[truncated ${snippet.length - perFile} chars]`;
      truncated = true;
    }
    const block = `<file path="${file.path}">\n${snippet}\n</file>`;
    if (totalChars + block.length > budget.maxChars) {
      droppedFiles.push(file.path);
      continue;
    }
    totalChars += block.length;
    includedFiles.push(truncated ? `${file.path} (truncated)` : file.path);
    parts.push(block);
  }
  for (const file of files.slice(budget.maxFiles)) {
    droppedFiles.push(file.path);
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `${userPrompt}\n\nProject context (${includedFiles.length} files):\n${parts.join('\n')}`,
    },
  ];
  return { messages, includedFiles, droppedFiles, redacted, totalChars };
}
