import type { IProviderAdapter } from '../adapters/IProviderAdapter';
import type { ProviderInfo } from '../types';

export class ProviderAdapterRegistry {
  private adapters = new Map<string, IProviderAdapter>();

  register(adapter: IProviderAdapter): void {
    if (this.adapters.has(adapter.slug)) {
      throw new Error(`Provider adapter already registered: ${adapter.slug}`);
    }
    this.adapters.set(adapter.slug, adapter);
  }

  get(slug: string): IProviderAdapter {
    const adapter = this.adapters.get(slug);
    if (!adapter) {
      throw new Error(`Unknown provider: ${slug}. Available: ${this.listSlugs().join(', ')}`);
    }
    return adapter;
  }

  has(slug: string): boolean {
    return this.adapters.has(slug);
  }

  listSlugs(): string[] {
    return Array.from(this.adapters.keys());
  }

  listProviders(): ProviderInfo[] {
    return Array.from(this.adapters.values()).map((a) => ({
      slug: a.slug,
      displayName: a.displayName,
      description: a.description,
      icon: a.icon,
      mode: a.mode,
      authMethod: a.authMethod,
      secretNames: a.apiConfig.secretNames,
      gpuOptionsAvailable: true,
    }));
  }
}
