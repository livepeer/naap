import type { CapacityRequest, SummaryData, SortField, FilterState } from './types';

export function computeSummary(requests: CapacityRequest[]): SummaryData {
  if (requests.length === 0) {
    return {
      totalRequests: 0,
      totalGPUsNeeded: 0,
      mostDesiredGPU: null,
      mostPopularPipeline: null,
      topRequestor: null,
      avgHourlyRate: 0,
    };
  }

  const totalGPUsNeeded = requests.reduce((sum, r) => sum + r.count, 0);
  const avgHourlyRate = requests.reduce((sum, r) => sum + r.hourlyRate, 0) / requests.length;

  // Most desired GPU
  const gpuCounts: Record<string, number> = {};
  requests.forEach((r) => {
    gpuCounts[r.gpuModel] = (gpuCounts[r.gpuModel] || 0) + r.count;
  });
  const topGPU = Object.entries(gpuCounts).sort((a, b) => b[1] - a[1])[0];

  // Most popular pipeline
  const pipelineCounts: Record<string, number> = {};
  requests.forEach((r) => {
    pipelineCounts[r.pipeline] = (pipelineCounts[r.pipeline] || 0) + 1;
  });
  const topPipeline = Object.entries(pipelineCounts).sort((a, b) => b[1] - a[1])[0];

  // Top requestor
  const requestorCounts: Record<string, number> = {};
  requests.forEach((r) => {
    requestorCounts[r.requesterName] = (requestorCounts[r.requesterName] || 0) + 1;
  });
  const topRequestor = Object.entries(requestorCounts).sort((a, b) => b[1] - a[1])[0];

  return {
    totalRequests: requests.length,
    totalGPUsNeeded,
    mostDesiredGPU: topGPU ? { model: topGPU[0], count: topGPU[1] } : null,
    mostPopularPipeline: topPipeline ? { name: topPipeline[0], count: topPipeline[1] } : null,
    topRequestor: topRequestor ? { name: topRequestor[0], count: topRequestor[1] } : null,
    avgHourlyRate,
  };
}

export function filterRequests(requests: CapacityRequest[], filters: FilterState): CapacityRequest[] {
  return requests.filter((r) => {
    // Search across multiple fields
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const searchable = [
        r.requesterName,
        r.requesterAccount,
        r.gpuModel,
        r.pipeline,
        r.reason,
        r.osVersion,
        r.cudaVersion,
      ]
        .join(' ')
        .toLowerCase();
      if (!searchable.includes(q)) return false;
    }

    // GPU Model filter
    if (filters.gpuModel && r.gpuModel !== filters.gpuModel) return false;

    // VRAM filter
    if (filters.vramMin && r.vram < parseInt(filters.vramMin)) return false;

    // Pipeline filter
    if (filters.pipeline && r.pipeline !== filters.pipeline) return false;

    return true;
  });
}

export function sortRequests(requests: CapacityRequest[], sortField: SortField): CapacityRequest[] {
  const sorted = [...requests];
  switch (sortField) {
    case 'newest':
      return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case 'gpuCount':
      return sorted.sort((a, b) => b.count - a.count);
    case 'hourlyRate':
      return sorted.sort((a, b) => b.hourlyRate - a.hourlyRate);
    case 'riskLevel':
      return sorted.sort((a, b) => b.riskLevel - a.riskLevel);
    case 'mostCommits':
      return sorted.sort((a, b) => b.softCommits.length - a.softCommits.length);
    case 'deadline':
      return sorted.sort((a, b) => new Date(a.validUntil).getTime() - new Date(b.validUntil).getTime());
    default:
      return sorted;
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return `${Math.abs(diffDays)}d ago`;
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays <= 7) return `${diffDays}d left`;
  if (diffDays <= 30) return `${Math.ceil(diffDays / 7)}w left`;
  return `${Math.ceil(diffDays / 30)}mo left`;
}

export function getUniqueValues(requests: CapacityRequest[], field: 'gpuModel' | 'pipeline'): string[] {
  const values = new Set(requests.map((r) => r[field]));
  return Array.from(values).sort();
}
