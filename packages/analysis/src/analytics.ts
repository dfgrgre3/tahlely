import type { AnalysisRun, Finding, Severity } from '@tahlely/domain';
import { scoreProject } from './quality-score.js';
import { diffRuns } from './run-diff.js';

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export interface RunPoint {
  runId: string;
  profileId: string;
  mode: string;
  createdAt: string;
  filesScanned: number;
  durationMs: number;
  total: number;
  bySeverity: Record<string, number>;
  score: number;
  grade: string;
}

export interface TrendDelta {
  findingsDelta: number;
  scoreDelta: number;
  introduced: number;
  resolved: number;
  persisting: number;
  fixRate: number;
}

export interface Hotspot {
  key: string;
  findings: number;
  critical: number;
  high: number;
  score: number;
}

export interface RuleStat {
  ruleId: string;
  count: number;
  topSeverity: Severity;
  files: number;
  example: string;
}

export interface AnalyzerStat {
  analyzerId: string;
  findings: number;
  share: number;
  topSeverity: Severity;
}

export interface ProjectAnalytics {
  runs: RunPoint[];
  latest?: RunPoint;
  previous?: RunPoint;
  delta?: TrendDelta;
  hotspots: { folders: Hotspot[]; files: Hotspot[] };
  topRules: RuleStat[];
  analyzers: AnalyzerStat[];
  severityMix: { severity: Severity; count: number; share: number }[];
}

function folderOf(path?: string): string {
  if (!path || path.startsWith('(')) return '(project)';
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') || '(root)';
}

function hotspotScore(critical: number, high: number, findings: number): number {
  return critical * 25 + high * 5 + findings;
}

/**
 * Full project analytics over run history. Deterministic and offline: every
 * number derives from persisted runs + findings — quality trend, fix rate
 * (resolved / previous total), per-folder and per-file hotspots ranked by
 * severity-weighted score, top rules with file spread, per-analyzer
 * effectiveness, and severity mix shares.
 */
export function analyzeProject(
  runs: AnalysisRun[],
  findingsByRun: Map<string, Finding[]> | Record<string, Finding[]>,
): ProjectAnalytics {
  const byRun: Map<string, Finding[]> =
    findingsByRun instanceof Map ? findingsByRun : new Map(Object.entries(findingsByRun));
  const ordered = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const points: RunPoint[] = ordered.map((run) => {
    const findings = byRun.get(run.id) ?? [];
    const bySeverity: Record<string, number> = {};
    for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    const quality = scoreProject(findings, run.summary);
    return {
      runId: run.id,
      profileId: run.profileId,
      mode: run.mode,
      createdAt: run.createdAt,
      filesScanned: run.summary?.filesScanned ?? 0,
      durationMs: run.summary?.durationMs ?? 0,
      total: findings.length,
      bySeverity,
      score: quality.score,
      grade: quality.grade,
    };
  });

  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  let delta: TrendDelta | undefined;
  if (latest && previous) {
    const current = byRun.get(latest.runId) ?? [];
    const before = byRun.get(previous.runId) ?? [];
    const diff = diffRuns(before, current);
    delta = {
      findingsDelta: latest.total - previous.total,
      scoreDelta: latest.score - previous.score,
      introduced: diff.introduced.length,
      resolved: diff.resolved.length,
      persisting: diff.persisting.length,
      fixRate: before.length > 0 ? diff.resolved.length / before.length : 0,
    };
  }

  const latestFindings = (latest && byRun.get(latest.runId)) || [];
  const folderAgg = new Map<string, { findings: number; critical: number; high: number }>();
  const fileAgg = new Map<string, { findings: number; critical: number; high: number }>();
  for (const f of latestFindings) {
    const folder = folderOf(f.path);
    const fa = folderAgg.get(folder) ?? { findings: 0, critical: 0, high: 0 };
    fa.findings += 1;
    if (f.severity === 'critical') fa.critical += 1;
    if (f.severity === 'high') fa.high += 1;
    folderAgg.set(folder, fa);
    const key = f.path ?? '(project-wide)';
    const ia = fileAgg.get(key) ?? { findings: 0, critical: 0, high: 0 };
    ia.findings += 1;
    if (f.severity === 'critical') ia.critical += 1;
    if (f.severity === 'high') ia.high += 1;
    fileAgg.set(key, ia);
  }
  const toHotspots = (agg: Map<string, { findings: number; critical: number; high: number }>): Hotspot[] =>
    [...agg.entries()]
      .map(([key, v]) => ({ key, ...v, score: hotspotScore(v.critical, v.high, v.findings) }))
      .sort((a, b) => b.score - a.score || b.findings - a.findings)
      .slice(0, 10);

  const ruleAgg = new Map<string, { count: number; files: Set<string>; topRank: number; topSeverity: Severity; example: string }>();
  const rankOf = (s: Severity): number => SEVERITIES.indexOf(s);
  for (const f of latestFindings) {
    let entry = ruleAgg.get(f.ruleId);
    if (!entry) {
      entry = { count: 0, files: new Set(), topRank: rankOf(f.severity), topSeverity: f.severity, example: f.path ? `${f.path}${f.line ? `:${f.line}` : ''}` : '' };
      ruleAgg.set(f.ruleId, entry);
    }
    entry.count += 1;
    if (f.path) entry.files.add(f.path);
    if (rankOf(f.severity) < entry.topRank) {
      entry.topRank = rankOf(f.severity);
      entry.topSeverity = f.severity;
    }
  }
  const topRules: RuleStat[] = [...ruleAgg.entries()]
    .map(([ruleId, v]) => ({ ruleId, count: v.count, topSeverity: v.topSeverity, files: v.files.size, example: v.example }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const analyzerAgg = new Map<string, { count: number; topRank: number; topSeverity: Severity }>();
  for (const f of latestFindings) {
    const id = ruleIdToAnalyzer(f.ruleId);
    let entry = analyzerAgg.get(id);
    if (!entry) {
      entry = { count: 0, topRank: rankOf(f.severity), topSeverity: f.severity };
      analyzerAgg.set(id, entry);
    }
    entry.count += 1;
    if (rankOf(f.severity) < entry.topRank) {
      entry.topRank = rankOf(f.severity);
      entry.topSeverity = f.severity;
    }
  }
  const total = Math.max(1, latestFindings.length);
  const analyzers: AnalyzerStat[] = [...analyzerAgg.entries()]
    .map(([analyzerId, v]) => ({ analyzerId, findings: v.count, share: v.count / total, topSeverity: v.topSeverity }))
    .sort((a, b) => b.findings - a.findings);

  const severityMix = SEVERITIES.map((severity) => {
    const count = latestFindings.filter((f) => f.severity === severity).length;
    return { severity, count, share: latestFindings.length > 0 ? count / latestFindings.length : 0 };
  });

  return {
    runs: points,
    latest,
    previous,
    delta,
    hotspots: { folders: toHotspots(folderAgg), files: toHotspots(fileAgg) },
    topRules,
    analyzers,
    severityMix,
  };
}

function ruleIdToAnalyzer(ruleId: string): string {
  const dot = ruleId.indexOf('.');
  if (dot > 0) return ruleId.slice(0, dot);
  const dash = ruleId.indexOf('-');
  return dash > 0 ? ruleId.slice(0, dash) : ruleId;
}

export function renderTrendAscii(points: RunPoint[]): string {
  if (points.length === 0) return '(no runs yet)';
  const max = Math.max(1, ...points.map((p) => p.total));
  return points
    .map((p) => {
      const width = Math.round((p.total / max) * 24);
      const bar = '█'.repeat(width) || '▁';
      return `${p.createdAt.slice(0, 10)} · ${p.profileId} · score ${p.score} · findings ${p.total} ${bar}`;
    })
    .join('\n');
}
