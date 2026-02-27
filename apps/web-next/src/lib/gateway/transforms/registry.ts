/**
 * Service Gateway — Transform Registry
 *
 * Central registry for body transform, auth, and response transform strategies.
 * Strategies are registered at bootstrap and looked up by name at runtime (O(1)).
 */

import type {
  BodyTransformStrategy,
  AuthStrategy,
  ResponseTransformStrategy,
} from './types';

class TransformRegistry {
  private bodyTransforms = new Map<string, BodyTransformStrategy>();
  private authStrategies = new Map<string, AuthStrategy>();
  private responseTransforms = new Map<string, ResponseTransformStrategy>();

  registerBody(strategy: BodyTransformStrategy): void {
    this.bodyTransforms.set(strategy.name, strategy);
  }

  registerAuth(strategy: AuthStrategy): void {
    this.authStrategies.set(strategy.name, strategy);
  }

  registerResponse(strategy: ResponseTransformStrategy): void {
    this.responseTransforms.set(strategy.name, strategy);
  }

  getBody(name: string): BodyTransformStrategy {
    if (name.startsWith('extract:')) {
      const strategy = this.bodyTransforms.get('extract');
      if (strategy) return strategy;
    }
    const strategy = this.bodyTransforms.get(name);
    if (!strategy) {
      const fallback = this.bodyTransforms.get('passthrough');
      if (fallback) return fallback;
      throw new Error(`No body transform strategy registered for "${name}"`);
    }
    return strategy;
  }

  getAuth(name: string): AuthStrategy {
    const strategy = this.authStrategies.get(name);
    if (!strategy) {
      const fallback = this.authStrategies.get('none');
      if (fallback) return fallback;
      throw new Error(`No auth strategy registered for "${name}"`);
    }
    return strategy;
  }

  getResponse(name: string): ResponseTransformStrategy {
    const strategy = this.responseTransforms.get(name);
    if (!strategy) {
      throw new Error(`No response transform strategy registered for "${name}"`);
    }
    return strategy;
  }

  listBody(): string[] {
    return Array.from(this.bodyTransforms.keys());
  }

  listAuth(): string[] {
    return Array.from(this.authStrategies.keys());
  }

  listResponse(): string[] {
    return Array.from(this.responseTransforms.keys());
  }
}

export const registry = new TransformRegistry();
