import type { Finding } from './finding.js';
import type { AnalysisId, ConversationId, ProjectId, ReportId } from './ids.js';

export const REPORT_FORMATS = ['markdown', 'html', 'json', 'csv', 'sarif'] as const;
/**
 * Canonical export formats. PDF is intentionally deferred (Phase N): it is a
 * print rendering of the HTML report, not a separate data model.
 */
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export interface ReportSection {
  id: string;
  title: string;
  body: string;
  findingIds: string[];
}

export interface Report {
  id: ReportId;
  projectId: ProjectId;
  analysisIds: AnalysisId[];
  conversationId?: ConversationId;
  title: string;
  format: ReportFormat;
  sections: ReportSection[];
  /** Denormalized snapshot of findings at generation time (auditability). */
  findings: Finding[];
  generatedBy: 'tool' | 'ai' | 'hybrid' | 'user';
  createdAt: string;
}
