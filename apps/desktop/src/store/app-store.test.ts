import { describe, expect, it } from 'vitest';
import { useAppStore } from './app-store.js';

describe('app store', () => {
  it('loads the demo project and runs an analysis end to end', async () => {
    const store = useAppStore.getState();
    await store.refresh();
    await store.openDemo();
    const afterOpen = useAppStore.getState();
    expect(afterOpen.projects.length).toBeGreaterThan(0);
    expect(afterOpen.activeProjectId).toBeDefined();

    await afterOpen.runAnalysis('standard', 'tool-only');
    const afterAnalysis = useAppStore.getState();
    expect(afterAnalysis.analyses.length).toBeGreaterThan(0);
    const rules = new Set(afterAnalysis.findings.map((f) => f.ruleId));
    expect(rules.has('imports.broken-relative-import')).toBe(true);
    expect(rules.has('security-heuristics.hardcoded-secret')).toBe(true);

    const latest = afterAnalysis.analyses[afterAnalysis.analyses.length - 1];
    if (latest) {
      await afterAnalysis.generateReport(latest.id, 'Demo report');
      expect(useAppStore.getState().reports.length).toBe(1);
    }

    await afterAnalysis.sendMessage('Summarize the findings.');
    expect(useAppStore.getState().messages.length).toBeGreaterThanOrEqual(2);
  }, 60000);
});
