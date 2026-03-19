import { describe, it, expect } from 'vitest';
import { ErrorBoundary } from '../components/ErrorBoundary.js';

describe('ErrorBoundary', () => {
  it('is exported as a class (function)', () => {
    expect(typeof ErrorBoundary).toBe('function');
    expect(ErrorBoundary.prototype).toBeDefined();
  });

  it('has getDerivedStateFromError static method', () => {
    expect(typeof ErrorBoundary.getDerivedStateFromError).toBe('function');
  });

  it('getDerivedStateFromError returns { hasError: true, error }', () => {
    const error = new Error('test error');
    const state = ErrorBoundary.getDerivedStateFromError(error);
    expect(state).toEqual({ hasError: true, error });
  });

  it('getDerivedStateFromError captures different error types', () => {
    const typeError = new TypeError('type mismatch');
    const state = ErrorBoundary.getDerivedStateFromError(typeError);
    expect(state.hasError).toBe(true);
    expect(state.error).toBe(typeError);
    expect(state.error?.message).toBe('type mismatch');
  });

  it('has componentDidCatch on the prototype', () => {
    expect(typeof ErrorBoundary.prototype.componentDidCatch).toBe('function');
  });

  it('has a render method on the prototype', () => {
    expect(typeof ErrorBoundary.prototype.render).toBe('function');
  });
});
