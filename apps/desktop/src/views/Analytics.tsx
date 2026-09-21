import { useEffect, useMemo, useState } from 'react';
import { analyzeProject, renderTrendAscii } from '@tahlely/analysis';
import type { Finding } from '@tahlely/domain';
import { useAppStore } from '../store/app-store.js';
import { services } from '../services/bootstrap.js';
import { Badge, CodeBlock, EmptyState, Grid, PageHeader, Panel, Stat, Tabs } from '../components/design-system.js';

export function Analytics() {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const analyses = useAppStore((state) => state.analyses);
  const [byRun, setByRun] = useState<Record<string, Finding[]>>({});
  const [tab, setTab] = useState<'trend' | 'hotspots' | 'rules' | 'analyzers'>('trend');

  useEffect(() => {
    if (!activeProjectId) return;
    const runs = analyses.slice(-12);
    Promise.all(runs.map(async (run) => [run.id, await services.analyses.listFindings(activeProjectId, run.id)] as const))
      .then((entries) => setByRun(Object.fromEntries(entries)))
      .catch(() => setByRun({}));
  }, [activeProjectId, analyses.length]);

  const analytics = useMemo(() => analyzeProject(analyses.slice(-12), byRun), [analyses, byRun]);

  if (!activeProjectId) {
    return (
      <Panel title="Analytics">
        <EmptyState title="No project selected" hint="Open a project to see its analytics." />
      </Panel>
    );
  }
  if (analyses.length === 0) {
    return (
      <Panel title="Analytics">
        <EmptyState title="No runs yet" hint="Run a comprehensive analysis to seed trends." />
      </Panel>
    );
  }

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle={`${analytics.runs.length} runs · fix rate ${((analytics.delta?.fixRate ?? 0) * 100).toFixed(0)}% · score ${analytics.latest?.score ?? '—'}`}
      />
      <Grid>
        <Stat label="Quality score" value={`${analytics.latest?.score ?? 0}/100`} hint={`grade ${analytics.latest?.grade ?? '—'}`} />
        <Stat label="Findings delta" value={analytics.delta ? `${analytics.delta.findingsDelta >= 0 ? '+' : ''}${analytics.delta.findingsDelta}` : '—'} hint={analytics.delta ? `+${analytics.delta.introduced} new · −${analytics.delta.resolved} fixed` : 'need 2 runs'} />
        <Stat label="Persisting" value={analytics.delta?.persisting ?? 0} hint="open in both runs" />
        <Stat label="Top hotspot" value={analytics.hotspots.folders[0]?.key ?? '—'} hint={analytics.hotspots.folders[0] ? `${analytics.hotspots.folders[0].findings} findings` : undefined} />
      </Grid>
      <Tabs
        tabs={[
          { value: 'trend', label: 'Trend' },
          { value: 'hotspots', label: `Hotspots (${analytics.hotspots.folders.length + analytics.hotspots.files.length})` },
          { value: 'rules', label: `Top rules (${analytics.topRules.length})` },
          { value: 'analyzers', label: `Analyzers (${analytics.analyzers.length})` },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'trend' ? (
        <>
          <Panel title="Quality & findings trend (last 12 runs)">
            <CodeBlock code={renderTrendAscii(analytics.runs)} language="text" />
          </Panel>
          <Panel title="Severity mix (latest run)">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Severity</th><th>Count</th><th>Share</th></tr></thead>
                <tbody>
                  {analytics.severityMix.map((row) => (
                    <tr key={row.severity}>
                      <td><Badge tone={row.severity}>{row.severity}</Badge></td>
                      <td>{row.count}</td>
                      <td>{(row.share * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      ) : null}
      {tab === 'hotspots' ? (
        <div className="explorer">
          <Panel title="Folder hotspots (severity-weighted)">
            <div className="list">
              {analytics.hotspots.folders.map((h) => (
                <div className="row" key={h.key}>
                  <Badge tone={h.critical > 0 ? 'critical' : h.high > 0 ? 'high' : 'medium'}>{h.score.toFixed(0)}</Badge>
                  <div className="grow"><strong>{h.key}</strong><div className="dim">{h.findings} findings · {h.critical}C · {h.high}H</div></div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="File hotspots (severity-weighted)">
            <div className="list">
              {analytics.hotspots.files.map((h) => (
                <div className="row" key={h.key}>
                  <Badge tone={h.critical > 0 ? 'critical' : h.high > 0 ? 'high' : 'medium'}>{h.score.toFixed(0)}</Badge>
                  <div className="grow"><strong>{h.key}</strong><div className="dim">{h.findings} findings · {h.critical}C · {h.high}H</div></div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      ) : null}
      {tab === 'rules' ? (
        <Panel title="Top rules (latest run)">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Rule</th><th>Count</th><th>Top severity</th><th>Files</th><th>Example</th></tr></thead>
              <tbody>
                {analytics.topRules.map((r) => (
                  <tr key={r.ruleId}>
                    <td><code>{r.ruleId}</code></td>
                    <td>{r.count}</td>
                    <td><Badge tone={r.topSeverity}>{r.topSeverity}</Badge></td>
                    <td>{r.files}</td>
                    <td><code>{r.example}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
      {tab === 'analyzers' ? (
        <Panel title="Analyzer effectiveness (share of latest findings)">
          <div className="list">
            {analytics.analyzers.map((a) => (
              <div className="row" key={a.analyzerId}>
                <Badge>{a.analyzerId}</Badge>
                <div className="grow">
                  <strong>{a.findings} findings</strong>
                  <div className="dim">share {(a.share * 100).toFixed(1)}% · top <Badge tone={a.topSeverity}>{a.topSeverity}</Badge></div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
