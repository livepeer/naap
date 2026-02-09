import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Plus, Search, X } from 'lucide-react';
import { Card, Badge, VersionBadge } from '@naap/ui';
import type { Orchestrator } from '@naap/types';

const mockOrchestrators: Orchestrator[] = [
  {
    id: 'orch-1', address: '0x1234567890abcdef1234567890abcdef12345678', operatorName: 'GPU Fleet Alpha',
    serviceUri: 'https://gpu-fleet.io/orch', region: 'US-East', gpuType: 'RTX 4090', gpuCount: 8,
    vram: 24, cudaVersion: '12.2', memoryBandwidth: '1008 GB/s', interconnects: 'NVLink',
    status: 'active', currentLoad: 75, maxCapacity: 100, successRate: 99.2, latencyScore: 92,
    pricePerUnit: { 'text-to-image': 0.002, llm: 0.005 },
    supportedPipelines: ['text-to-image', 'llm', 'image-to-image'],
    earningsToday: 245.50, ticketsWon: 142, ticketsPending: 12, aiWorkers: [], version: 'v0.8.12',
  },
  {
    id: 'orch-2', address: '0xabcdef1234567890abcdef1234567890abcdef12', operatorName: 'Neural Compute Co',
    serviceUri: 'https://neural-compute.co/api', region: 'EU-West', gpuType: 'A100', gpuCount: 4,
    vram: 80, cudaVersion: '12.1', memoryBandwidth: '2039 GB/s', interconnects: 'InfiniBand',
    status: 'active', currentLoad: 60, maxCapacity: 100, successRate: 99.8, latencyScore: 95,
    pricePerUnit: { 'text-to-image': 0.003, llm: 0.008 },
    supportedPipelines: ['text-to-image', 'llm', 'segment-anything-2'],
    earningsToday: 389.20, ticketsWon: 98, ticketsPending: 5, aiWorkers: [], version: 'v0.8.12',
  },
  {
    id: 'orch-3', address: '0x7890abcdef1234567890abcdef1234567890abcd', operatorName: 'Decentralized AI',
    serviceUri: 'https://dai.network/orch', region: 'Asia-Pacific', gpuType: 'H100', gpuCount: 2,
    vram: 80, cudaVersion: '12.3', memoryBandwidth: '3350 GB/s', interconnects: 'NVSwitch',
    status: 'suspended', currentLoad: 0, maxCapacity: 100, successRate: 98.5, latencyScore: 88,
    pricePerUnit: { 'text-to-image': 0.004, llm: 0.01 },
    supportedPipelines: ['text-to-image', 'llm'],
    earningsToday: 0, ticketsWon: 0, ticketsPending: 0, aiWorkers: [], version: 'v0.8.10',
  },
];

const statusColors = { active: 'emerald', suspended: 'amber', updating: 'blue' } as const;

export const OrchestratorsPage: React.FC = () => {
  const [selectedOrch, setSelectedOrch] = useState<Orchestrator | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredOrchestrators = mockOrchestrators.filter((o) =>
    o.operatorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    o.address.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-outfit font-bold text-text-primary">Orchestrators</h1>
          <p className="text-text-secondary mt-1">GPU compute providers on the network</p>
        </div>
        <button className="flex items-center gap-2 px-6 py-3 bg-accent-emerald text-white rounded-xl font-bold shadow-lg shadow-accent-emerald/20 hover:bg-accent-emerald/90 transition-all">
          <Plus size={18} /> Deploy Orchestrator
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
        <input type="text" placeholder="Search orchestrators..." value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-bg-secondary border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:border-accent-blue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredOrchestrators.map((orch) => (
          <motion.div key={orch.id} layoutId={orch.id} onClick={() => setSelectedOrch(orch)}
            className="glass-card p-6 cursor-pointer hover:border-accent-blue/30 transition-all group">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-accent-blue to-purple-500 flex items-center justify-center">
                  <Cpu size={24} className="text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-text-primary">{orch.operatorName}</h3>
                  <p className="text-xs font-mono text-text-secondary">{orch.gpuType} × {orch.gpuCount}</p>
                </div>
              </div>
              <Badge variant={statusColors[orch.status]}>{orch.status}</Badge>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div><p className="text-xs text-text-secondary">Load</p><p className="font-mono font-bold text-text-primary">{orch.currentLoad}%</p></div>
              <div><p className="text-xs text-text-secondary">Success</p><p className="font-mono font-bold text-accent-emerald">{orch.successRate}%</p></div>
              <div><p className="text-xs text-text-secondary">Earnings</p><p className="font-mono font-bold text-accent-amber">${orch.earningsToday}</p></div>
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-white/5">
              <span className="text-sm text-text-secondary">{orch.region}</span>
              <VersionBadge current={orch.version} />
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {selectedOrch && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={() => setSelectedOrch(null)} />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              className="fixed right-0 top-0 h-full w-[500px] bg-bg-secondary border-l border-white/10 z-50 p-6 overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">{selectedOrch.operatorName}</h2>
                <button onClick={() => setSelectedOrch(null)} className="p-2 hover:bg-white/5 rounded-lg"><X size={24} /></button>
              </div>
              <div className="space-y-4">
                <Card><div className="grid grid-cols-2 gap-4">
                  <div><p className="text-xs text-text-secondary">GPU</p><p className="font-bold">{selectedOrch.gpuType}</p></div>
                  <div><p className="text-xs text-text-secondary">Count</p><p className="font-bold">{selectedOrch.gpuCount}</p></div>
                  <div><p className="text-xs text-text-secondary">VRAM</p><p className="font-bold">{selectedOrch.vram}GB</p></div>
                  <div><p className="text-xs text-text-secondary">CUDA</p><p className="font-bold">{selectedOrch.cudaVersion}</p></div>
                </div></Card>
                <Card title="Pipelines">
                  <div className="flex flex-wrap gap-2">{selectedOrch.supportedPipelines.map(p => <Badge key={p} variant="secondary">{p}</Badge>)}</div>
                </Card>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OrchestratorsPage;
