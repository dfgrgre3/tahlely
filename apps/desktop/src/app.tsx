import { useEffect } from 'react';
import { HashRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import type { ProjectId } from '@tahlely/domain';
import { useAppStore } from './store/app-store.js';
import { services } from './services/bootstrap.js';
import { ErrorBanner } from './components/design-system.js';
import { Dashboard } from './views/Dashboard.js';
import { Analytics } from './views/Analytics.js';
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

const NAV_GROUPS: { section: string; items: { to: string; label: string; icon: string }[] }[] = [
  {
    section: 'Analyze',
    items: [
      { to: '/', label: 'Overview', icon: '◈' },
      { to: '/analytics', label: 'Analytics', icon: '📊' },
      { to: '/workspace', label: 'Workspace', icon: '▣' },
      { to: '/analyze', label: 'Analyzer', icon: '◉' },
      { to: '/review', label: 'Review', icon: '✎' },
      { to: '/duplicates', label: 'Duplicates', icon: '⧉' },
      { to: '/reports', label: 'Reports', icon: '▤' },
    ],
  },
  {
    section: 'Collaborate',
    items: [
      { to: '/projects', label: 'Projects', icon: '▦' },
      { to: '/conversations', label: 'Conversations', icon: '✉' },
      { to: '/agents', label: 'Agents', icon: '⚙' },
      { to: '/approvals', label: 'Approvals', icon: '✓' },
    ],
  },
  {
    section: 'System',
    items: [
      { to: '/terminal', label: 'Terminal', icon: '›' },
      { to: '/models', label: 'Models', icon: '⬢' },
      { to: '/settings', label: 'Settings', icon: '☰' },
    ],
  },
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
        <div className="brand-wrap">
          <div className="brand-mark">T</div>
          <div className="brand">
            <span>Tahlely</span>
            <small>AI Engineering Platform</small>
          </div>
        </div>

        <div className="nav-section">Tahlely</div>
        {NAV_GROUPS.map((group) => (
          <div key={group.section}>
            <div className="nav-section">{group.section}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                <span className="nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span>{item.label}</span>
                {item.to === '/approvals' && approvals.length > 0 ? (
                  <span className="nav-count">{approvals.length}</span>
                ) : null}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="sidebar-footer">
          <span className="dim">Tahlely 0.1.0 · comprehensive analysis by default</span>
        </div>
      </nav>
      <main className="main">
        <div className="topbar">
          <select
            className="input input-select"
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
          <div className="topbar-actions">
            <span className="status-pill status-pill-success">Live</span>
            <span className="status-pill">
              {activeProject ? activeProject.kind : 'foundation 0.1.0'}
            </span>
          </div>
        </div>
        {error ? <ErrorBanner message={error} onDismiss={clearError} /> : null}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/analytics" element={<Analytics />} />
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
