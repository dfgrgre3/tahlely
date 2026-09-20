import type { CSSProperties, ReactNode } from 'react';
import type { Severity } from '@tahlely/domain';
import type { DiffLine } from '../services/diff.js';

/**
 * Reusable design-system primitives. Feature views compose these — no
 * one-off buttons, badges, or panels elsewhere in the UI.
 */

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button className={`btn btn-${variant}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className="field">
      {label ? <span className="field-label">{label}</span> : null}
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label?: string;
}) {
  return (
    <label className="field">
      {label ? <span className="field-label">{label}</span> : null}
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Panel({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>{title}</h2>
        <div className="panel-actions">{actions}</div>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

const SEVERITY_TONE: Record<Severity, string> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  info: 'info',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={SEVERITY_TONE[severity]}>{severity.toUpperCase()}</Badge>;
}

export function ProgressBar({ value }: { value: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="progress" role="progressbar" aria-valuenow={percent}>
      <div className="progress-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {hint ? <p className="empty-hint">{hint}</p> : null}
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      <button className="btn btn-ghost" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <pre className="code" data-language={language ?? 'text'}>
      <code>{code}</code>
    </pre>
  );
}

export function DiffBlock({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="code diff">
      <code>
        {lines.slice(0, 300).map((line, index) => (
          <span key={index} className={`diff-${line.kind}`}>
            {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
            {line.text}
            {'\n'}
          </span>
        ))}
      </code>
    </pre>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function Grid({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="grid" style={style}>
      {children}
    </div>
  );
}
