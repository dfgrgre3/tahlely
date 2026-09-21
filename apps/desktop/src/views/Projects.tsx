import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/app-store.js';
import { isTauri } from '../services/tauri-bridge.js';
import type { UploadedFile } from '../services/folder-import.js';
import { normalizeUploadedFile, shouldSkipUpload } from '../services/folder-import.js';
import { Badge, Button, EmptyState, Input, PageHeader, Panel, SearchInput } from '../components/design-system.js';

export function Projects() {
  const navigate = useNavigate();
  const projects = useAppStore((state) => state.projects);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const busy = useAppStore((state) => state.busy);
  const openDemo = useAppStore((state) => state.openDemo);
  const openFolder = useAppStore((state) => state.openFolder);
  const importFolder = useAppStore((state) => state.importFolder);
  const removeProject = useAppStore((state) => state.removeProject);
  const selectProject = useAppStore((state) => state.selectProject);
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const folderInput = useRef<HTMLInputElement>(null);
  const inTauri = isTauri();
  const visible = query.trim()
    ? projects.filter((p) => `${p.name} ${p.rootPath} ${p.kind}`.toLowerCase().includes(query.trim().toLowerCase()))
    : projects;

  const onUploadFolder = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files: UploadedFile[] = [];
    let rootName = '';
    for (const file of Array.from(list)) {
      const uploaded = normalizeUploadedFile(file as File & { webkitRelativePath?: string });
      rootName = rootName || uploaded.rootName || 'project';
      if (shouldSkipUpload(file.name, file.size)) continue;
      try {
        files.push({ relativePath: uploaded.relativePath, content: await file.text() });
      } catch {
        // Unreadable entry — skipped, import continues with the rest.
      }
    }
    await importFolder(name.trim() || rootName || 'Uploaded project', files);
    navigate('/review');
  };

  const open = async () => {
    if (!path.trim()) return;
    await openFolder(path.trim(), name.trim() || path.trim().split(/[/\\]/).pop() || 'Project');
    navigate('/workspace');
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Open folders, upload in the browser, or explore the demo pipeline"
        actions={
          <Button variant="secondary" disabled={busy} onClick={() => void openDemo()}>
            Load demo project
          </Button>
        }
      />
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
          <Button
            variant="secondary"
            disabled={busy}
            title="Upload a whole project folder (works in the browser too)"
            onClick={() => folderInput.current?.click()}
          >
            {busy ? 'Importing…' : 'Upload project folder'}
          </Button>
          <input
            ref={(el) => {
              folderInput.current = el;
              if (el) {
                el.setAttribute('directory', '');
                el.setAttribute('webkitdirectory', '');
                el.setAttribute('multiple', 'multiple');
              }
            }}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(event) => {
              void onUploadFolder(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
      </Panel>
      <Panel title={`Workspace projects (${visible.length}/${projects.length})`}>
        <SearchInput value={query} onChange={setQuery} placeholder="Filter projects…" />
        {visible.length === 0 ? (
          <EmptyState title="No projects registered" hint="Open a folder or load the demo." />
        ) : (
          <div className="list">
            {visible.map((project) => (
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
