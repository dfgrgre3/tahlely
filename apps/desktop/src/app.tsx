import { useEffect } from 'react';
import { HashRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import type { ProjectId } from '@tahlely/domain';
import { useAppStore } from './store/app-store.js';
import { services } from './services/bootstrap.js';
import { ErrorBanner } from './components/design-system.js';
import { Dashboard } from './views/Dashboard.js';
import { Projects } from './views/Projects.js';
import { Workspace } from './views/Workspace.js';
import { Reports } from './views/Reports.js';
import { FileAnalyzer } from './views/FileAnalyzer.js';
import { FileReview } from './views/FileReview.js';
import { Duplicates } from './views/Duplicates.js';
import { Conversations } from './views/Conversations.js';
import { Agents } from './views/Agents.js';
import { Approvals } from './views/Approvals.js';
import { Terminal } from './views/Terminal.js';
import { Settings } from './views/Settings.js';
import { Models } from './views/Models.js';

const NAV: { to: string; label: string }[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/projects', label: 'Projects' },
  { to: '/workspace', label: 'Workspace' },
  { to: '/analyze', label: 'File Analyzer' },
  { to: '/review', label: 'File Review' },
  { to: '/duplicates', label: 'Duplicates' },
  { to: '/reports', label: 'Reports' },
  { to: '/conversations', label: 'Conversations' },
  { to: '/agents', label: 'Agents' },
  { to: '/approvals', label: 'Approvals' },
  { to: '/terminal', label: 'Terminal' },
  { to: '/models', label: 'Models' },
  { to: '/settings', label: 'Settings' },
];

function Shell() {
  const projects = useAppStore((state) => state.projects);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const approvals = useAppStore((state) => state.approvals);
  const error = useAppStore((state) => state.error);
  const clearError = useAppStore((state) => state.clearError);
  const selectProject = useAppStore((state) => state.selectProject);
  const refresh = useAppStore((state) => state.refresh);
  const appendActivity = useAppStore((state) => state.appendActivity);
  const navigate = useNavigate();

  useEffect(() => {
    void refresh();
    const offs = [
      services.bus.on('ProjectOpened', (event) =>
        appendActivity(`[project] opened ${event.payload.rootPath}`),
      ),
      services.bus.on('AnalysisCompleted', (event) =>
        appendActivity(
          `[analysis] ${event.payload.analysisId} completed: ${event.payload.findings} findings`,
        ),
      ),
      services.bus.on('PermissionRequested', (event) =>
        appendActivity(`[approval] requested ${event.payload.permission}`),
      ),
      services.bus.on('ReportGenerated', (event) =>
        appendActivity(`[report] generated ${event.payload.reportId}`),
      ),
      services.bus.on('ExecutionFailed', (event) =>
        appendActivity(`[exec] failed: ${event.payload.error}`),
      ),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          Tahlely<small>AI Engineering Platform</small>
        </div>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            {item.label}
            {item.to === '/approvals' && approvals.length > 0 ? ` (${approvals.length})` : ''}
          </NavLink>
        ))}
      </nav>
      <main className="main">
        <div className="topbar">
          <select
            className="input"
            value={activeProjectId ?? ''}
            onChange={(event) => {
              const id = event.target.value as ProjectId;
              if (id) {
                void selectProject(id).then(() => navigate('/workspace'));
              }
            }}
          >
            <option value="">No project selected</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <div className="spacer" />
          <span className="dim">{activeProject ? activeProject.kind : 'foundation 0.1.0'}</span>
        </div>
        {error ? <ErrorBanner message={error} onDismiss={clearError} /> : null}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/workspace" element={<Workspace />} />
          <Route path="/analyze" element={<FileAnalyzer />} />
          <Route path="/review" element={<FileReview />} />
          <Route path="/duplicates" element={<Duplicates />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/conversations" element={<Conversations />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/terminal" element={<Terminal />} />
          <Route path="/models" element={<Models />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
