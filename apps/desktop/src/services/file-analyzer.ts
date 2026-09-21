import { startAnalysis } from '@tahlely/application';
import type { AnalyzerFile } from '@tahlely/analysis';
import { buildReport } from '@tahlely/reporting';
import { MemoryFileSystem } from '@tahlely/infrastructure';
import type {
  AnalysisMode,
  ConversationId,
  FileNode,
  LanguageId,
  ProjectId,
  Provider,
  ProviderId,
  Report,
} from '@tahlely/domain';
import { newId, utcNow } from '@tahlely/domain';
import { ensureConversation, services } from './bootstrap.js';

/** User-facing analysis engine choice for single-file/snippet analysis. */
export type SnippetAnalysisMode = 'tool' | 'ai' | 'both';

export interface SnippetAnalysisInput {
  projectId: ProjectId;
  conversationId?: string;
  content: string;
  fileName?: string;
  source: 'paste' | 'upload' | 'url';
  mode: SnippetAnalysisMode;
}

export interface SnippetAnalysisResult {
  report: Report;
  conversationId: string;
  aiReview?: string;
}

const EXT_TO_LANGUAGE: Record<string, LanguageId> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  cs: 'csharp',
  cpp: 'cpp',
  rb: 'ruby',
  php: 'php',
  html: 'html',
  css: 'css',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  sql: 'sql',
  sh: 'shell',
};

export function languageForFileName(fileName: string): LanguageId {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANGUAGE[ext] ?? 'unknown';
}

const MODE_TO_ANALYSIS_MODE: Record<SnippetAnalysisMode, AnalysisMode> = {
  tool: 'tool-only',
  ai: 'ai-only',
  both: 'hybrid',
};

const MODE_TO_GENERATED_BY: Record<SnippetAnalysisMode, Report['generatedBy']> = {
  tool: 'tool',
  ai: 'ai',
  both: 'hybrid',
};

/**
 * Default report naming: uploaded files keep their name; pasted/fetched
 * content is named after its first meaningful line.
 */
export function deriveReportTitle(content: string, fileName?: string): string {
  if (fileName?.trim()) {
    return `Analysis: ${fileName.trim()}`;
  }
  const firstLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('#'));
  if (!firstLine) return 'Analysis: empty snippet';
  const hint = firstLine
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .trim()
    .slice(0, 48);
  return hint ? `Snippet report: ${hint}` : 'Snippet report';
}

/** Deterministic heuristic guess of what a pasted snippet is used for. */
export function guessSnippetPurpose(content: string): string {
  const text = content.toLowerCase();
  if (/\b(select|insert|update|delete)\b[\s\S]*\bfrom\b/.test(text)) return 'SQL query';
  if (/\bimport\b.*\bfrom\b|\bexport\b/.test(text)) return 'JavaScript/TypeScript module';
  if (/\bdef\s+\w+\s*\(/.test(text)) return 'Python code';
  if (/\bfn\s+\w+\s*\(/.test(text)) return 'Rust code';
  if (/<\w+[^>]*>[\s\S]*<\/\w+>/.test(text)) return 'HTML markup';
  if (/\bpackage\b\s+\w+/.test(text)) return 'Go code';
  return 'source code snippet';
}

/**
 * Analyze a single file or pasted snippet and produce a comprehensive report
 * bound to the active conversation. Tool mode runs the deterministic
 * analyzer engine on a virtual file; AI mode asks the configured provider
 * (mock offline fallback) for a full review; "both" merges them.
 */
export async function analyzeSnippetFile(
  input: SnippetAnalysisInput,
): Promise<SnippetAnalysisResult> {
  const content = input.content;
  if (!content.trim()) {
    throw new Error('Nothing to analyze — paste text, upload a file, or fetch a URL first.');
  }
  const conversationId = (input.conversationId ??
    (await ensureConversation(input.projectId))) as ConversationId;
  const fileName = input.fileName?.trim() || 'snippet.txt';
  const title = deriveReportTitle(content, input.fileName);
  const analysisMode = MODE_TO_ANALYSIS_MODE[input.mode];

  const node: FileNode = {
    id: newId('file'),
    projectId: input.projectId,
    path: `/snippet/${fileName}`,
    relativePath: fileName,
    name: fileName,
    extension: fileName.split('.').pop()?.toLowerCase() ?? '',
    language: languageForFileName(fileName),
    size: content.length,
    ignored: false,
    generated: false,
    binary: false,
    analyzed: true,
    importance: 0,
    risk: 0,
  };
  const files: AnalyzerFile[] = [{ node, content }];

  let analysisIds: Report['analysisIds'] = [];
  let findings: Report['findings'] = [];
  if (input.mode !== 'ai') {
    const fs = new MemoryFileSystem();
    const run = await startAnalysis(
      {
        projects: services.projects,
        conversations: services.conversations,
        analyses: services.analyses,
        policies: services.policies,
        changes: services.changes,
        audit: services.audit,
        fs,
        events: services.bus,
      },
      {
        projectId: input.projectId,
        conversationId,
        mode: analysisMode,
        profileId: 'snippet',
        analyzers: services.engine.analyzers.kinds(),
        targetPaths: [fileName],
      },
    );
    const outcome = await services.engine.execute(run, files, {
      saveRun: (value) => services.analyses.saveRun(value),
      saveFindings: (values) => services.analyses.saveFindings(values),
    });
    analysisIds = [outcome.run.id];
    findings = outcome.findings;
  }

  let aiReview: string | undefined;
  if (input.mode !== 'tool') {
    aiReview = await reviewWithAi(content, fileName, analysisMode);
  }

  const report = buildReport({
    projectId: input.projectId,
    analysisIds,
    conversationId,
    title,
    format: 'markdown',
    findings,
    generatedBy: MODE_TO_GENERATED_BY[input.mode],
  });
  report.sections.unshift({
    id: 'input',
    title: 'Input',
    body: [
      `Source: ${input.source} · File: ${fileName}`,
      `Detected purpose: ${guessSnippetPurpose(content)}`,
      `Lines: ${content.split('\n').length} · Size: ${content.length} chars`,
      `Mode: ${input.mode}`,
    ].join('\n'),
    findingIds: [],
  });
  if (aiReview) {
    report.sections.push({ id: 'ai-review', title: 'AI Review', body: aiReview, findingIds: [] });
  }
  await services.reports.saveReport(report);
  await services.bus.emit(
    'ReportGenerated',
    { reportId: report.id, projectId: input.projectId, format: report.format },
    input.projectId,
  );
  return { report, conversationId, aiReview };
}

async function reviewWithAi(
  content: string,
  fileName: string,
  mode: AnalysisMode,
): Promise<string> {
  const provider: Provider = {
    id: 'mock' as ProviderId,
    name: 'Mock (offline)',
    kind: 'local',
    enabled: true,
    createdAt: utcNow(),
    updatedAt: utcNow(),
  };
  const instance = services.registry.getOrCreate(provider, {});
  const response = await instance.chat({
    model: 'mock/mock-reviewer',
    messages: [
      {
        role: 'system',
        content:
          'You are a senior code reviewer. Produce a comprehensive report: purpose of the code, ' +
          'issues with exact line numbers, security risks, improvement suggestions with improved ' +
          'line versions, and an overall quality score.',
      },
      {
        role: 'user',
        content: `Analyze this file (${fileName}, mode: ${mode}):\n\n${content.slice(0, 12000)}`,
      },
    ],
  });
  return response.content;
}
