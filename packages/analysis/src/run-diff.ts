import type { Finding } from '@tahlely/domain';

export interface RunDiff {
  /** Findings present now that were absent in the previous run. */
  introduced: Finding[];
  /** Findings from the previous run that no longer reproduce. */
  resolved: Finding[];
  /** Findings present in both runs (still open). */
  persisting: Finding[];
}

function signature(finding: Pick<Finding, 'ruleId' | 'path' | 'line' | 'title'>): string {
  return `${finding.ruleId}|${finding.path ?? ''}|${finding.line ?? ''}|${finding.title}`;
}

/**
 * Compare two runs of the same tool analyzers: what is new, what was fixed,
 * and what is still open. Matching is exact on rule + location + title; a
 * finding that only moved lines is reported as resolved + introduced, which
 * the report surfaces as one pair to review.
 */
export function diffRuns(previous: Finding[], current: Finding[]): RunDiff {
  const before = new Map(previous.map((finding) => [signature(finding), finding]));
  const now = new Map(current.map((finding) => [signature(finding), finding]));
  const introduced = [...now.entries()]
    .filter(([key]) => !before.has(key))
    .map(([, finding]) => finding);
  const resolved = [...before.entries()]
    .filter(([key]) => !now.has(key))
    .map(([, finding]) => finding);
  const persisting = [...now.entries()]
    .filter(([key]) => before.has(key))
    .map(([, finding]) => finding);
  return { introduced, resolved, persisting };
}
