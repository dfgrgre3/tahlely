import { redactSecrets } from '@tahlely/security';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 'app' | 'analysis' | 'agent' | 'execution' | 'security' | 'audit';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogRecord {
  at: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  context: Record<string, unknown>;
}

export interface LogSink {
  write(record: LogRecord): void;
}

/**
 * Structured logger. Every message passes through secret redaction; categories
 * let operators separate application, analysis, agent, execution, security,
 * and audit streams. No API keys, passwords, or tokens ever reach a sink.
 */
export class Logger {
  private readonly sinks: LogSink[];
  private readonly minLevel: LogLevel;
  private readonly baseContext: Record<string, unknown>;

  constructor(options?: {
    sinks?: LogSink[];
    minLevel?: LogLevel;
    context?: Record<string, unknown>;
  }) {
    this.sinks = options?.sinks ?? [consoleSink()];
    this.minLevel = options?.minLevel ?? 'debug';
    this.baseContext = options?.context ?? {};
  }

  child(context: Record<string, unknown>): Logger {
    return new Logger({
      sinks: this.sinks,
      minLevel: this.minLevel,
      context: { ...this.baseContext, ...context },
    });
  }

  debug(category: LogCategory, message: string, context: Record<string, unknown> = {}): void {
    this.log('debug', category, message, context);
  }

  info(category: LogCategory, message: string, context: Record<string, unknown> = {}): void {
    this.log('info', category, message, context);
  }

  warn(category: LogCategory, message: string, context: Record<string, unknown> = {}): void {
    this.log('warn', category, message, context);
  }

  error(category: LogCategory, message: string, context: Record<string, unknown> = {}): void {
    this.log('error', category, message, context);
  }

  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    context: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const record: LogRecord = {
      at: new Date().toISOString(),
      level,
      category,
      message: redactSecrets(message),
      context: redactRecord({ ...this.baseContext, ...context }),
    };
    for (const sink of this.sinks) sink.write(record);
  }
}

function redactRecord(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = redactValue(value, key);
  }
  return out;
}

function redactValue(value: unknown, key?: string): unknown {
  if (key && /secret|password|token|api[_-]?key|authorization/i.test(key)) {
    return '[REDACTED]';
  }

  if (typeof value === 'string') {
    return redactSecrets(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry));
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = redactValue(childValue, childKey);
    }
    return out;
  }

  return value;
}

export function consoleSink(): LogSink {
  return {
    write(record: LogRecord): void {
      const line = JSON.stringify(record);
      if (record.level === 'error') console.error(line);
      else if (record.level === 'warn') console.warn(line);
      else console.log(line);
    },
  };
}

/** In-memory sink for tests and the in-app log viewer. */
export class MemorySink implements LogSink {
  readonly records: LogRecord[] = [];
  write(record: LogRecord): void {
    this.records.push(record);
  }
}
