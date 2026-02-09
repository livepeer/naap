import React, { useState } from 'react';
import { Zap, Plus, ThumbsUp, Clock, DollarSign } from 'lucide-react';
import { Card, Badge } from '@naap/ui';
import type { CapacityRequest } from '@naap/types';

const mockRequests: CapacityRequest[] = [
  {
    id: 'req-1',
    requesterName: 'Livepeer Studio - AI Video Team',
    requesterAccount: '0x7a3b...f29c',
    gpuModel: 'RTX 4090',
    vram: 24,
    osVersion: 'Ubuntu 22.04',
    cudaVersion: '12.2',
    count: 10,
    pipeline: 'text-to-image',
    startDate: '2026-02-15',
    endDate: '2026-04-15',
    validUntil: '2026-02-28',
    hourlyRate: 1.20,
    reason: 'Increased demand for Flux.1 model',
    riskLevel: 5,
    softCommits: [
      { id: 'sc-1', userId: 'u-1', userName: 'NodeRunner Pro', timestamp: '2026-01-20T10:00:00Z' },
    ],
    comments: [],
    createdAt: '2026-01-15T08:00:00Z',
    status: 'active',
  },
  {
    id: 'req-2',
    requesterName: 'Decentralized AI Labs',
    requesterAccount: '0x3f91...a84e',
    gpuModel: 'A100 80GB',
    vram: 80,
    osVersion: 'Ubuntu 22.04',
    cudaVersion: '12.1',
    count: 5,
    pipeline: 'llm',
    startDate: '2026-03-01',
    endDate: '2026-06-01',
    validUntil: '2026-02-20',
    hourlyRate: 2.50,
    reason: 'LLM inference capacity expansion',
    riskLevel: 4,
    softCommits: [],
    comments: [],
    createdAt: '2026-01-12T14:00:00Z',
    status: 'active',
  },
  {
    id: 'req-3',
    requesterName: 'Render Core',
    requesterAccount: '0x8bc2...d71f',
    gpuModel: 'H100',
    vram: 80,
    osVersion: 'Ubuntu 24.04',
    cudaVersion: '12.4',
    count: 3,
    pipeline: 'segment-anything-2',
    startDate: '2026-03-15',
    endDate: '2026-05-15',
    validUntil: '2026-03-01',
    hourlyRate: 3.80,
    reason: 'SAM2 workload support',
    riskLevel: 3,
    softCommits: [],
    comments: [],
    createdAt: '2026-01-10T11:00:00Z',
    status: 'active',
  },
];

export const CapacityPage: React.FC = () => {
  const [, setSelectedRequest] = useState<CapacityRequest | null>(null);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-outfit font-bold text-text-primary">Capacity Requests</h1>
          <p className="text-text-secondary mt-1">Coordinate GPU capacity with network operators</p>
        </div>
        <button className="flex items-center gap-2 px-6 py-3 bg-accent-emerald text-white rounded-xl font-bold shadow-lg shadow-accent-emerald/20 hover:bg-accent-emerald/90 transition-all">
          <Plus size={18} /> New Request
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {mockRequests.map((req) => (
          <Card key={req.id} className="hover:border-accent-blue/30 transition-all cursor-pointer" onClick={() => setSelectedRequest(req)}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-text-primary">{req.requesterName}</h3>
                <p className="text-xs text-text-secondary font-mono">{req.requesterAccount}</p>
                <p className="text-sm text-text-secondary mt-1">{req.pipeline}</p>
              </div>
              <Badge variant="blue">{req.gpuModel} x {req.count}</Badge>
            </div>
            <p className="text-sm text-text-secondary mb-4">{req.reason}</p>
            <div className="flex items-center justify-between pt-4 border-t border-white/5">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1 text-accent-emerald"><ThumbsUp size={14} /><span className="text-sm">{req.softCommits.length} commits</span></div>
                <div className="flex items-center gap-1 text-accent-emerald"><DollarSign size={14} /><span className="text-sm">${req.hourlyRate}/hr</span></div>
                <div className="flex items-center gap-1 text-text-secondary"><Clock size={14} /><span className="text-sm">{req.validUntil}</span></div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {mockRequests.length === 0 && (
        <Card className="text-center py-16">
          <Zap size={48} className="mx-auto mb-4 text-text-secondary opacity-30" />
          <h3 className="text-lg font-bold text-text-primary mb-2">No active requests</h3>
          <p className="text-text-secondary">Create a new capacity request to get started</p>
        </Card>
      )}
    </div>
  );
};

export default CapacityPage;
