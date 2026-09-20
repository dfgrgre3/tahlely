import { describe, expect, it } from 'vitest';
import { resolveInsideRoot } from '@tahlely/security';
import { assertNoShellMetachars } from '@tahlely/security';

describe('path guard', () => {
  it('resolves relative paths inside the root', () => {
    const resolved = resolveInsideRoot('/repo', 'src/a.ts');
    expect(resolved.absolute).toBe('/repo/src/a.ts');
    expect(resolved.relative).toBe('src/a.ts');
  });

  it('rejects traversal escapes', () => {
    expect(() => resolveInsideRoot('/repo', '../../etc/passwd')).toThrow(/escapes/);
    expect(() => resolveInsideRoot('/repo', '/etc/passwd')).toThrow(/escapes/);
  });

  it('rejects sibling-prefix tricks', () => {
    expect(() => resolveInsideRoot('/repo', '/repo-evil/x')).toThrow(/escapes/);
  });

  it('rejects null bytes and shell metachars', () => {
    expect(() => resolveInsideRoot('/repo', 'a\0b')).toThrow();
    expect(() => assertNoShellMetachars('git status; rm -rf /')).toThrow();
    expect(() => assertNoShellMetachars('git status')).not.toThrow();
  });
});
