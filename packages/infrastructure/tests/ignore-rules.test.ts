import { describe, expect, it } from 'vitest';
import { IgnoreMatcher, builtinIgnoreRules } from '@tahlely/infrastructure';

describe('ignore rules', () => {
  it('ignores built-in directories at any depth', () => {
    const matcher = new IgnoreMatcher(builtinIgnoreRules().map((rule) => rule.pattern));
    expect(matcher.isIgnored('node_modules/react/index.js')).toBe(true);
    expect(matcher.isIgnored('src/node_modules/x')).toBe(true);
    expect(matcher.isIgnored('src/index.ts')).toBe(false);
  });

  it('supports globs and negation', () => {
    const matcher = new IgnoreMatcher(['dist/', '*.log', '!keep.log']);
    expect(matcher.isIgnored('dist/bundle.js')).toBe(true);
    expect(matcher.isIgnored('a.log')).toBe(true);
    expect(matcher.isIgnored('keep.log')).toBe(false);
  });
});
