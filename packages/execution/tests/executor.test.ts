import { describe, expect, it } from 'vitest';
import { EventBus } from '@tahlely/application';
import { CommandExecutor } from '@tahlely/execution/node';

describe('command executor', () => {
  it('rejects non-allowlisted commands', async () => {
    const executor = new CommandExecutor(new EventBus());
    await expect(executor.execute({ command: 'rm', args: ['-rf', '/'] })).rejects.toThrow(
      /allowlisted/,
    );
  });

  it('rejects shell metacharacters in the command without spawning', async () => {
    const executor = new CommandExecutor(new EventBus());
    // `;` in the command position is rejected before any allowlist check or
    // spawn. (Args may contain punctuation: with shell:false they are inert.)
    await expect(executor.execute({ command: 'node; evil' })).rejects.toThrow(/metachar/);
  });

  it('runs an allowlisted command with capped output', async () => {
    const executor = new CommandExecutor(new EventBus());
    const result = await executor.execute({
      command: 'node',
      args: ['-e', 'console.log(40 + 2)'],
      timeoutMs: 15000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('42');
  });

  it('enforces the emergency stop', async () => {
    const executor = new CommandExecutor(new EventBus());
    executor.setEmergencyStop(true);
    expect(executor.isStopped()).toBe(true);
    await expect(executor.execute({ command: 'node', args: ['--version'] })).rejects.toThrow(
      /emergency stop/,
    );
    executor.setEmergencyStop(false);
    const result = await executor.execute({ command: 'node', args: ['--version'] });
    expect(result.exitCode).toBe(0);
  });

  it('times out long-running commands', async () => {
    const executor = new CommandExecutor(new EventBus());
    await expect(
      executor.execute({
        command: 'node',
        args: ['-e', 'setTimeout(() => {}, 30000)'],
        timeoutMs: 500,
      }),
    ).rejects.toThrow(/timed out/);
  });
});
