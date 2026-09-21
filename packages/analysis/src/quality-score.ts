import type { AnalysisSummary, Finding, Severity } from '@tahlely/domain';

export type QualityGrade = 'A' | 'B' | 'C' | 'D' | 'F';

const PENALTY: Record<Severity, number> = {
  critical: 25,
  high: 5,
  medium: 2,
  low: 0.5,
  info: 0,
};

export interface QualityScore {
  /** 0–100 deterministic score. */
  score: number;
  grade: QualityGrade;
  totalIssues: number;
  hygieneIssues: number;
  criticalOpen: number;
  /** Top (ruleId → count) pairs driving the score. */
  topRules: { ruleId: string; count: number }[];
}

/**
 * Deterministic project quality score. Severity-weighted penalties turn raw
 * findings into a single 0–100 number with an A–F grade — reproducible for
 * the same code, with no model in the loop.
 */
export function scoreProject(findings: Finding[], summary?: AnalysisSummary): QualityScore {
  const bySeverity: Record<string, number> = {};
  const byRule: Record<string, number> = {};
  let hygieneIssues = 0;
  for (const finding of findings) {
    const severity = finding.severity as Severity;
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    byRule[finding.ruleId] = (byRule[finding.ruleId] ?? 0) + 1;
    if (
      finding.ruleId.startsWith('hygiene.') ||
      finding.ruleId.startsWith('security-heuristics.')
    ) {
      hygieneIssues += 1;
    }
  }
  // Scale by project size: lower-severity noise dilutes across files, but
  // critical/high issues always count at full weight — a leak is a leak.
  const filesScanned = Math.max(0, summary?.filesScanned ?? 0);
  const dilution = 1 + Math.log10(Math.max(1, filesScanned));
  let penalty = 0;
  for (const finding of findings) {
    const weight = PENALTY[finding.severity as Severity] ?? 0;
    const dilutable = finding.severity === 'critical' || finding.severity === 'high' ? 1 : dilution;
    penalty += weight / dilutable;
  }
  const score = Math.max(0, Math.round(100 - penalty));
  return {
    score,
    grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F',
    totalIssues: findings.length,
    hygieneIssues,
    criticalOpen: bySeverity['critical'] ?? 0,
    topRules: Object.entries(byRule)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([ruleId, count]) => ({ ruleId, count })),
  };
}
