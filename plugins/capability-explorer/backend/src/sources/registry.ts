import type { CapabilityDataSource } from './interface.js';

const sources = new Map<string, CapabilityDataSource>();

export function registerSource(source: CapabilityDataSource): void {
  sources.set(source.id, source);
}

export function getSource(id: string): CapabilityDataSource | undefined {
  return sources.get(id);
}

export function getSources(): CapabilityDataSource[] {
  return Array.from(sources.values());
}

export function getEnabledSources(
  enabledMap: Record<string, boolean>,
): CapabilityDataSource[] {
  return getSources().filter((s) => enabledMap[s.id] !== false);
}

export function getCoreSources(
  enabledMap: Record<string, boolean>,
): CapabilityDataSource[] {
  return getEnabledSources(enabledMap).filter((s) => s.type === 'core');
}

export function getEnrichmentSources(
  enabledMap: Record<string, boolean>,
): CapabilityDataSource[] {
  return getEnabledSources(enabledMap).filter((s) => s.type === 'enrichment');
}
