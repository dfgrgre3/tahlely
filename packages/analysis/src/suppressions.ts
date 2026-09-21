/**
 * Suppression comments: reviewers can silence a finding inline without
 * touching code behavior. Supported in every language:
 *   // tahlely-ignore [rule.id]              (same line)
 *   // tahlely-ignore-next-line [rule.id]    (next line)
 *   // tahlely-ignore-file [rule.id]         (whole file)
 * `#` and `<!-- -->` comment styles work the same way. A bare comment with
 * no rule id suppresses every rule for its scope.
 */
export interface Suppression {
  line: number;
  scope: 'line' | 'next-line' | 'file';
  ruleId?: string;
}

const PATTERNS = [
  /\/\/\s*tahlely-ignore(-file|-next-line)?(?:\s+([\w.-]+))?/,
  /#\s*tahlely-ignore(-file|-next-line)?(?:\s+([\w.-]+))?/,
  /<!--\s*tahlely-ignore(-file|-next-line)?(?:\s+([\w.-]+))?\s*-->/,
];

/** Parse suppression directives from file content (1-based lines). */
export function parseSuppressions(content: string): Suppression[] {
  const out: Suppression[] = [];
  content.split('\n').forEach((line, index) => {
    const lineNo = index + 1;
    for (const pattern of PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      const marker = match[1];
      const ruleId = match[2];
      out.push({
        line: lineNo,
        scope: marker === '-file' ? 'file' : marker === '-next-line' ? 'next-line' : 'line',
        ruleId,
      });
      break;
    }
  });
  return out;
}

interface Suppressable {
  path?: string;
  line?: number;
  ruleId: string;
}

/** Drop findings covered by an inline suppression for their file/line/rule. */
export function applySuppressions<T extends Suppressable>(
  findings: T[],
  contentsByPath: Map<string, string>,
): T[] {
  if (findings.length === 0) return findings;
  const parsed = new Map<string, Suppression[]>();
  const suppressionsFor = (path?: string): Suppression[] => {
    if (!path) return [];
    const cached = parsed.get(path);
    if (cached) return cached;
    const content = contentsByPath.get(path);
    const result = content === undefined ? [] : parseSuppressions(content);
    parsed.set(path, result);
    return result;
  };
  return findings.filter((finding) => {
    const suppressions = suppressionsFor(finding.path ?? '');
    if (suppressions.length === 0) return true;
    return !suppressions.some((suppression) => {
      if (suppression.ruleId && suppression.ruleId !== finding.ruleId) return false;
      if (suppression.scope === 'file') return true;
      if (finding.line === undefined) return false;
      if (suppression.scope === 'line') return suppression.line === finding.line;
      return suppression.line + 1 === finding.line;
    });
  });
}
