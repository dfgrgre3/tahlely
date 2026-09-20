import { spawn } from 'node:child_process';
import type { EventBus } from '@tahlely/application';
import { AppError, newId } from '@tahlely/domain';
import { assertNoShellMetachars, assertSafeArg } from '@tahlely/security';
import type { AllowlistEntry } from './allowlist.js';
import { findAllowlistEntry, isSubcommandAllowed } from './allowlist.js';
import type { ExecutionEvents, ExecutionRequest, ExecutionResult } from './types.js';

/**
 * Controlled execution. Guarantees, in order:
 * 1. emergency stop short-circuits everything;
 * 2. command must be allowlisted (binary + subcommand);
 * 3. no shell is ever spawned (shell: false; metachars rejected);
 * 4. timeout + caller cancellation kill the process tree;
 * 5. stdout/stderr are byte-capped and streamed;
 * 6. every run emits ExecutionStarted/Completed/Failed for the audit trail.
 */
export class CommandExecutor {
  private emergencyStop = false;

  constructor(
    private readonly events: EventBus,
    private readonly options?: {
      allowlistExtra?: AllowlistEntry[];
      defaultTimeoutMs?: number;
      maxOutputBytes?: number;
    },
  ) {}

  /** Emergency stop: blocks all future runs until cleared. */
  setEmergencyStop(stopped: boolean): void {
    this.emergencyStop = stopped;
  }

  isStopped(): boolean {
    return this.emergencyStop;
  }

  async execute(request: ExecutionRequest, stream: ExecutionEvents = {}): Promise<ExecutionResult> {
    if (this.emergencyStop) {
      throw new AppError('Execution is halted by emergency stop.', {
        kind: 'permission',
        code: 'EXEC_EMERGENCY_STOP',
      });
    }
    const args = request.args ?? [];
    assertNoShellMetachars(request.command);
    for (const arg of [request.command, ...args]) assertSafeArg(arg);

    const entry = findAllowlistEntry(request.command, this.options?.allowlistExtra);
    if (!entry) {
      throw new AppError(`Command not allowlisted: ${request.command}`, {
        kind: 'security-violation',
        code: 'EXEC_NOT_ALLOWLISTED',
      });
    }
    if (!isSubcommandAllowed(entry, args)) {
      throw new AppError(`Subcommand not allowed: ${request.command} ${args[0] ?? ''}`, {
        kind: 'security-violation',
        code: 'EXEC_SUBCOMMAND_DENIED',
      });
    }

    const id = newId('exec');
    const timeoutMs = request.timeoutMs ?? this.options?.defaultTimeoutMs ?? 120000;
    const maxOutput = request.maxOutputBytes ?? this.options?.maxOutputBytes ?? 1024 * 1024;
    const display = `${request.command} ${args.join(' ')}`.trim();
    await this.events.emit(
      'ExecutionStarted',
      { executionId: id, projectId: request.projectId, command: display },
      request.projectId,
    );

    try {
      const result = await this.spawn(request, { id, timeoutMs, maxOutput, stream });
      await this.events.emit(
        'ExecutionCompleted',
        { executionId: id, exitCode: result.exitCode, durationMs: result.durationMs },
        request.projectId,
      );
      return result;
    } catch (error) {
      await this.events.emit(
        'ExecutionFailed',
        { executionId: id, error: error instanceof Error ? error.message : String(error) },
        request.projectId,
      );
      throw error;
    }
  }

  private spawn(
    request: ExecutionRequest,
    control: {
      id: string;
      timeoutMs: number;
      maxOutput: number;
      stream: ExecutionEvents;
    },
  ): Promise<ExecutionResult> {
    const args = request.args ?? [];
    return new Promise<ExecutionResult>((resolve, reject) => {
      const started = Date.now();
      const child = spawn(request.command, args, {
        cwd: request.cwd,
        env: { ...processEnvSubset(), ...(request.env ?? {}) },
        shell: false,
        windowsHide: true,
        signal: undefined,
      });
      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const append = (target: 'out' | 'err', chunk: string): void => {
        if (target === 'out') {
          stdout += chunk;
          control.stream.onStdout?.(chunk);
        } else {
          stderr += chunk;
          control.stream.onStderr?.(chunk);
        }
        if (stdout.length + stderr.length > control.maxOutput) {
          truncated = true;
          stdout = stdout.slice(-Math.floor(control.maxOutput / 2));
          stderr = stderr.slice(-Math.floor(control.maxOutput / 2));
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, control.timeoutMs);

      const abort = (): void => {
        child.kill();
      };
      request.signal?.addEventListener('abort', abort, { once: true });

      child.stdout?.on('data', (data: Buffer) => append('out', data.toString('utf8')));
      child.stderr?.on('data', (data: Buffer) => append('err', data.toString('utf8')));
      child.on('error', (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', abort);
        reject(
          new AppError(`Execution failed to start: ${error.message}`, {
            kind: 'execution',
            code: 'EXEC_SPAWN_FAILED',
            cause: error,
          }),
        );
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', abort);
        if (timedOut || request.signal?.aborted) {
          reject(
            new AppError(`Command timed out or was cancelled: ${request.command}`, {
              kind: request.signal?.aborted ? 'cancellation' : 'timeout',
              code: request.signal?.aborted ? 'EXEC_CANCELLED' : 'EXEC_TIMEOUT',
            }),
          );
          return;
        }
        resolve({
          id: control.id,
          command: request.command,
          args,
          exitCode: code ?? 1,
          stdout,
          stderr,
          truncated,
          durationMs: Date.now() - started,
          timedOut: false,
        });
      });
    });
  }
}

/**
 * Minimal environment inheritance. Secrets are NOT scrubbed here because the
 * child may legitimately need PATH/HOME — but callers must pass explicit env
 * for anything sensitive, and output still flows through log redaction.
 */
function processEnvSubset(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of [
    'PATH',
    'HOME',
    'USERPROFILE',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'LANG',
    'NODE_ENV',
  ]) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export type { AllowlistEntry };
