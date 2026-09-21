import { useMemo, useState } from 'react';
import type { FileNode } from '@tahlely/domain';
import { Badge } from './design-system.js';

export interface TreeNode {
  name: string;
  /** Full relative path (files) or folder prefix. */
  path: string;
  isFile: boolean;
  findings: number;
  children: TreeNode[];
}

/** Build a nested VS Code-style tree from flat indexed files. */
export function buildFileTree(files: FileNode[], findingsByPath: Map<string, number>): TreeNode[] {
  const roots: TreeNode[] = [];
  const folders = new Map<string, TreeNode>();
  for (const file of files) {
    const parts = file.relativePath.split('/');
    let siblings = roots;
    let prefix = '';
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i] ?? '';
      prefix = prefix ? `${prefix}/${part}` : part;
      const isFile = i === parts.length - 1;
      if (isFile) {
        siblings.push({
          name: part,
          path: file.path,
          isFile: true,
          findings: findingsByPath.get(file.relativePath) ?? 0,
          children: [],
        });
      } else {
        let folder = folders.get(prefix);
        if (!folder) {
          folder = { name: part, path: prefix, isFile: false, findings: 0, children: [] };
          folders.set(prefix, folder);
          siblings.push(folder);
        }
        folder.findings += findingsByPath.get(file.relativePath) ?? 0;
        siblings = folder.children;
      }
    }
  }
  const sortLevel = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => Number(a.isFile) - Number(b.isFile) || a.name.localeCompare(b.name))
      .map((node) => ({ ...node, children: sortLevel(node.children) }));
  return sortLevel(roots);
}

export function FileTree({
  files,
  findingsByPath,
  selectedPath,
  onSelect,
}: {
  files: FileNode[];
  findingsByPath: Map<string, number>;
  selectedPath?: string;
  onSelect: (file: FileNode) => void;
}) {
  const tree = useMemo(() => buildFileTree(files, findingsByPath), [files, findingsByPath]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNodes = (nodes: TreeNode[], depth: number) =>
    nodes.map((node) => (
      <div key={node.path}>
        <button
          className={`tree-row${node.isFile && node.path === selectedPath ? ' active' : ''}`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => {
            if (node.isFile) {
              const file = byPath.get(node.path);
              if (file) onSelect(file);
            } else {
              toggle(node.path);
            }
          }}
        >
          <span className="tree-icon">
            {node.isFile ? '📄' : collapsed.has(node.path) ? '▸' : '▾'}
          </span>
          <span className="tree-name">{node.name}</span>
          {node.findings > 0 ? <Badge tone="high">{node.findings}</Badge> : null}
        </button>
        {!node.isFile && !collapsed.has(node.path) ? renderNodes(node.children, depth + 1) : null}
      </div>
    ));

  return <div className="tree">{renderNodes(tree, 0)}</div>;
}
