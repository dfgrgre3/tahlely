import { describe, expect, it } from 'vitest';
import {
  AppError,
  CancellationError,
  isAppError,
  isCancellation,
  isIdOf,
  newId,
  userMessage,
} from '@tahlely/domain';

describe('ids', () => {
  it('creates prefixed unique ids', () => {
    const a = newId('prj');
    const b = newId('prj');
    expect(a).not.toBe(b);
    expect(isIdOf('prj', a)).toBe(true);
    expect(isIdOf('conv', a)).toBe(false);
  });
});

describe('errors', () => {
  it('carries kind, code, and JSON shape', () => {
    const error = new AppError('Nope.', { kind: 'validation', code: 'BAD' });
    expect(isAppError(error)).toBe(true);
    expect(error.toJSON()).toMatchObject({ kind: 'validation', code: 'BAD', message: 'Nope.' });
    expect(userMessage(error)).toBe('Nope.');
  });

  it('falls back to a default message per kind', () => {
    const error = new AppError(undefined, { kind: 'timeout' });
    expect(error.message.length).toBeGreaterThan(0);
  });

  it('recognizes cancellation across representations', () => {
    expect(isCancellation(new CancellationError())).toBe(true);
    expect(isCancellation(new AppError('x', { kind: 'cancellation' }))).toBe(true);
    expect(isCancellation(Object.assign(new Error('abort'), { name: 'AbortError' }))).toBe(true);
    expect(isCancellation(new Error('plain'))).toBe(false);
  });

  it('renders plain errors safely', () => {
    expect(userMessage(new Error('boom'))).toBe('boom');
    expect(userMessage(42)).toBe('An unexpected error occurred.');
  });
});
