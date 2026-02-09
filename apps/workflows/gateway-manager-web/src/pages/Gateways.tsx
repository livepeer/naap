import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Database, Plus, Search, ChevronRight, 
  Activity, Globe, Cpu, X, AlertTriangle,
  BarChart3, Settings, Zap
} from 'lucide-react';
import { Badge, VersionBadge } from '@naap/ui';
import type { Gateway } from '@naap/types';

const statusColors = {
  online: 'emerald',
  offline: 'rose',
  degraded: 'amber',
} as const;

interface GatewayCardProps {
  gateway: Gateway;
  onClick: () => void;
}

const GatewayCard: React.FC<GatewayCardProps> = ({ gateway, onClick }) => (
  <motion.div
    layoutId={gateway.id}
    onClick={onClick}
    className="glass-card p-6 cursor-pointer hover:border-accent-blue/30 transition-all group"
  >
    <div className="flex items-start justify-between mb-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-accent-blue to-accent-emerald flex items-center justify-center">
          <Database size={24} className="text-white" />
        </div>
        <div>
          <h3 className="font-bold text-text-primary group-hover:text-accent-blue transition-colors">
            {gateway.operatorName}
          </h3>
          <p className="text-xs font-mono text-text-secondary">{gateway.address.slice(0, 10)}...{gateway.address.slice(-4)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={statusColors[gateway.status]}>{gateway.status}</Badge>
        <ChevronRight size={18} className="text-text-secondary group-hover:text-accent-blue transition-colors" />
      </div>
    </div>

    <div className="grid grid-cols-4 gap-4 mb-4">
      <div>
        <p className="text-xs text-text-secondary">Region</p>
        <p className="font-medium text-text-primary">{gateway.region}</p>
      </div>
      <div>
        <p className="text-xs text-text-secondary">Jobs/min</p>
        <p className="font-mono font-bold text-accent-emerald">{gateway.jobsPerMinute}</p>
      </div>
      <div>
        <p className="text-xs text-text-secondary">Latency P50</p>
        <p className="font-mono text-text-primary">{gateway.latencyP50}ms</p>
      </div>
      <div>
        <p className="text-xs text-text-secondary">Uptime</p>
        <p className="font-mono text-text-primary">{gateway.uptime}%</p>
      </div>
    </div>

    <div className="flex items-center justify-between pt-4 border-t border-white/5">
      <div className="flex items-center gap-2">
        <Cpu size={14} className="text-text-secondary" />
        <span className="text-sm text-text-secondary">{gateway.connectedOrchestrators} orchestrators</span>
      </div>
      <VersionBadge current={gateway.version} />
    </div>
  </motion.div>
);

interface GatewayDetailPanelProps {
  gateway: Gateway;
  onClose: () => void;
}

const GatewayDetailPanel: React.FC<GatewayDetailPanelProps> = ({ gateway, onClose }) => {
  const [activeTab, setActiveTab] = useState('overview');

  const tabs = [
    { id: 'overview', label: 'Overview', icon: <Activity size={16} /> },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={16} /> },
    { id: 'orchestrators', label: 'Orchestrators', icon: <Cpu size={16} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
  ];

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed right-0 top-0 h-full w-[600px] bg-bg-secondary border-l border-white/10 z-50 overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="p-6 border-b border-white/10 bg-bg-tertiary/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-accent-blue to-accent-emerald flex items-center justify-center">
              <Database size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-text-primary">{gateway.operatorName}</h2>
              <p className="text-sm font-mono text-text-secondary">{gateway.address}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
            <X size={24} className="text-text-secondary" />
          </button>
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-4">
          <Badge variant={statusColors[gateway.status]} className="text-sm">
            {gateway.status.toUpperCase()}
          </Badge>
          <div className="flex items-center gap-1 text-text-secondary text-sm">
            <Globe size={14} />
            {gateway.region}
          </div>
          <VersionBadge current={gateway.version} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'text-accent-blue border-accent-blue'
                : 'text-text-secondary border-transparent hover:text-text-primary'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {activeTab === 'overview' && (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-bg-tertiary/50 rounded-xl">
                <p className="text-xs text-text-secondary mb-1">Jobs / Minute</p>
                <p className="text-2xl font-mono font-bold text-accent-emerald">{gateway.jobsPerMinute}</p>
              </div>
              <div className="p-4 bg-bg-tertiary/50 rounded-xl">
                <p className="text-xs text-text-secondary mb-1">Uptime</p>
                <p className="text-2xl font-mono font-bold text-text-primary">{gateway.uptime}%</p>
              </div>
              <div className="p-4 bg-bg-tertiary/50 rounded-xl">
                <p className="text-xs text-text-secondary mb-1">Latency P50</p>
                <p className="text-2xl font-mono font-bold text-text-primary">{gateway.latencyP50}ms</p>
              </div>
              <div className="p-4 bg-bg-tertiary/50 rounded-xl">
                <p className="text-xs text-text-secondary mb-1">Latency P99</p>
                <p className="text-2xl font-mono font-bold text-text-primary">{gateway.latencyP99}ms</p>
              </div>
            </div>

            {/* Capacity by Pipeline */}
            <div>
              <h3 className="text-sm font-bold text-text-secondary uppercase tracking-widest mb-3">Capacity by Pipeline</h3>
              <div className="space-y-3">
                {Object.entries(gateway.capacityByPipeline).map(([pipeline, data]) => (
                  <div key={pipeline} className="p-4 bg-bg-tertiary/50 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-text-primary capitalize">{pipeline.replace(/-/g, ' ')}</span>
                      <span className="text-sm text-text-secondary">
                        {data.current} / {data.desired}
                      </span>
                    </div>
                    <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-accent-blue rounded-full"
                        style={{ width: `${(data.current / data.desired) * 100}%` }}
                      />
                    </div>
                    {data.gap > 0 && (
                      <p className="text-xs text-accent-amber mt-2">
                        Gap: {data.gap} orchestrators needed
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Deposit Info */}
            <div className="p-4 bg-bg-tertiary/50 rounded-xl">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-text-secondary">Deposit / Reserve</p>
                  <p className="text-lg font-mono font-bold text-text-primary">
                    {gateway.deposit.toLocaleString()} / {gateway.reserve.toLocaleString()} LPT
                  </p>
                </div>
                <Zap size={24} className="text-accent-amber" />
              </div>
            </div>
          </>
        )}

        {activeTab === 'analytics' && (
          <div className="flex items-center justify-center h-64 border border-dashed border-white/10 rounded-xl">
            <div className="text-center text-text-secondary">
              <BarChart3 size={48} className="mx-auto mb-4 opacity-30" />
              <p>Analytics charts coming soon</p>
            </div>
          </div>
        )}

        {activeTab === 'orchestrators' && (
          <div className="space-y-4">
            <p className="text-text-secondary text-sm">
              {gateway.connectedOrchestrators} orchestrators connected
            </p>
            {/* Placeholder orchestrator list */}
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-4 bg-bg-tertiary/50 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-accent-blue/10 flex items-center justify-center">
                    <Cpu size={16} className="text-accent-blue" />
                  </div>
                  <div>
                    <p className="font-medium text-text-primary">Orchestrator {i + 1}</p>
                    <p className="text-xs text-text-secondary">RTX 4090 • 24GB VRAM</p>
                  </div>
                </div>
                <Badge variant="emerald">Active</Badge>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-4">
            <div className="p-4 bg-bg-tertiary/50 rounded-xl">
              <h4 className="font-medium text-text-primary mb-2">Service URI</h4>
              <code className="text-sm font-mono text-text-secondary">{gateway.serviceUri}</code>
            </div>
            <div className="p-4 bg-bg-tertiary/50 rounded-xl">
              <h4 className="font-medium text-text-primary mb-2">IP Address</h4>
              <code className="text-sm font-mono text-text-secondary">{gateway.ip}</code>
            </div>
            <div className="p-4 bg-bg-tertiary/50 rounded-xl">
              <h4 className="font-medium text-text-primary mb-2">Supported Pipelines</h4>
              <div className="flex flex-wrap gap-2 mt-2">
                {gateway.supportedPipelines.map((p) => (
                  <Badge key={p} variant="secondary">{p}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export const GatewaysPage: React.FC = () => {
  const [selectedGateway, setSelectedGateway] = useState<Gateway | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchGateways = async () => {
      try {
        setLoading(true);
        const response = await fetch('http://localhost:4001/api/v1/gateway-manager/gateways');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        // Transform backend data to match frontend Gateway type
        const transformedGateways: Gateway[] = data.gateways.map((gw: any) => ({
          id: gw.id,
          address: gw.address,
          operatorName: gw.operatorName,
          serviceUri: gw.serviceUri,
          region: gw.region,
          ip: gw.ip || '',
          status: gw.status as 'online' | 'offline' | 'degraded',
          uptime: gw.uptime,
          latencyP50: gw.latencyP50,
          latencyP99: gw.latencyP99,
          jobsPerMinute: gw.jobsPerMinute,
          deposit: parseInt(gw.deposit) / 1e18, // Convert wei to ETH
          reserve: parseInt(gw.reserve) / 1e18,
          supportedPipelines: gw.supportedPipelines,
          capacityByPipeline: {
            'text-to-image': { current: 20, desired: 25, gap: 5 },
            'llm': { current: 12, desired: 15, gap: 3 },
          },
          connectedOrchestrators: gw.connectedOrchestrators,
          version: gw.version,
        }));
        
        setGateways(transformedGateways);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch gateways:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch gateways');
      } finally {
        setLoading(false);
      }
    };

    fetchGateways();
  }, []);

  const filteredGateways = gateways.filter((gw) => {
    const matchesSearch = gw.operatorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      gw.address.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === 'all' || gw.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-10 h-10 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"></div>
        <p className="text-text-secondary text-sm">Loading gateways...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center px-8">
        <div className="w-16 h-16 rounded-full bg-accent-rose/10 flex items-center justify-center">
          <AlertTriangle size={32} className="text-accent-rose" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-text-primary mb-2">Failed to Load Gateways</h3>
          <p className="text-text-secondary text-sm max-w-md">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-outfit font-bold text-text-primary">Gateways</h1>
          <p className="text-text-secondary mt-1">Manage and monitor public AI compute gateways</p>
        </div>
        <button className="flex items-center gap-2 px-6 py-3 bg-accent-emerald text-white rounded-xl font-bold shadow-lg shadow-accent-emerald/20 hover:bg-accent-emerald/90 transition-all">
          <Plus size={18} />
          Deploy Gateway
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
          <input
            type="text"
            placeholder="Search gateways..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg-secondary border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:border-accent-blue transition-all"
          />
        </div>
        <div className="flex items-center gap-2 bg-bg-secondary border border-white/10 rounded-xl p-1">
          {['all', 'online', 'degraded', 'offline'].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                filterStatus === status
                  ? 'bg-accent-blue text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Gateway Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredGateways.map((gateway) => (
          <GatewayCard
            key={gateway.id}
            gateway={gateway}
            onClick={() => setSelectedGateway(gateway)}
          />
        ))}
      </div>

      {filteredGateways.length === 0 && (
        <div className="text-center py-16">
          <Database size={48} className="mx-auto mb-4 text-text-secondary opacity-30" />
          <h3 className="text-lg font-bold text-text-primary mb-2">No gateways found</h3>
          <p className="text-text-secondary">Try adjusting your search or filter criteria</p>
        </div>
      )}

      {/* Detail Panel */}
      <AnimatePresence>
        {selectedGateway && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
              onClick={() => setSelectedGateway(null)}
            />
            <GatewayDetailPanel
              gateway={selectedGateway}
              onClose={() => setSelectedGateway(null)}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default GatewaysPage;
