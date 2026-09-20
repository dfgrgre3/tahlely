import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/app-store.js';
import { isTauri } from '../services/tauri-bridge.js';
import { Badge, Button, EmptyState, Input, Panel } from '../components/design-system.js';

export function Projects() {
  const navigate = useNavigate();
  const projects = useAppStore((state) => state.projects);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const busy = useAppStore((state) => state.busy);
  const openDemo = useAppStore((state) => state.openDemo);
  const openFolder = useAppStore((state) => state.openFolder);
  const removeProject = useAppStore((state) => state.removeProject);
  const selectProject = useAppStore((state) => state.selectProject);
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const inTauri = isTauri();

  const open = async () => {
    if (!path.trim()) return;
    await openFolder(path.trim(), name.trim() || path.trim().split(/[/\\]/).pop() || 'Project');
    navigate('/workspace');
  };

  return (
    <div>
      <div className="topbar">
        <h1>Projects</h1>
        <div className="spacer" />
        <Button variant="secondary" disabled={busy} onClick={() => void openDemo()}>
          Load demo project
        </Button>
      </div>
      <Panel title="Open a project">
        {!inTauri ? (
          <p className="dim">
            Browser preview: local folders require the Tauri desktop build. The demo project
            exercises the full pipeline anywhere.
          </p>
        ) : null}
        <div className="toolbar">
          <Input label="Folder path" value={path} onChange={setPath} placeholder="D:/code/my-app" />
          <Input label="Display name" value={name} onChange={setName} placeholder="my-app" />
          <Button disabled={busy || !inTauri || !path.trim()} onClick={() => void open()}>
            Open folder
          </Button>
        </div>
      </Panel>
      <Panel title={`Workspace projects (${projects.length})`}>
        {projects.length === 0 ? (
          <EmptyState title="No projects registered" hint="Open a folder or load the demo." />
        ) : (
          <div className="list">
            {projects.map((project) => (
              <div className="row" key={project.id}>
                <div className="grow">
                  <strong>{project.name}</strong>
                  <div className="dim">{project.rootPath}</div>
                  <div className="dim">
                    <Badge>{project.kind}</Badge> {project.languages.join(', ') || 'unknown'} ·{' '}
                    {project.frameworks.join(', ') || 'no framework detected'}
                  </div>
                </div>
                {project.id === activeProjectId ? <Badge tone="medium">active</Badge> : null}
                <Button
                  variant="secondary"
                  onClick={() => {
                    void selectProject(project.id).then(() => navigate('/workspace'));
                  }}
                >
                  Open
                </Button>
                <Button variant="danger" onClick={() => void removeProject(project.id)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
