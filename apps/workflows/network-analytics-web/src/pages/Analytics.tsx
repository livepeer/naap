import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Card } from '@naap/ui';

const mockChartData = [
  { time: '00:00', jobs: 1200, latency: 45, utilization: 72 },
  { time: '04:00', jobs: 800, latency: 38, utilization: 58 },
  { time: '08:00', jobs: 1500, latency: 52, utilization: 85 },
  { time: '12:00', jobs: 2100, latency: 48, utilization: 92 },
  { time: '16:00', jobs: 1900, latency: 55, utilization: 88 },
  { time: '20:00', jobs: 1600, latency: 42, utilization: 78 },
];

export const AnalyticsPage: React.FC = () => {
  const [timeRange, setTimeRange] = useState('24h');

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-outfit font-bold text-text-primary">Network Analytics</h1>
          <p className="text-text-secondary mt-1">Real-time network performance metrics</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-bg-secondary border border-white/10 rounded-xl p-1">
            {['24h', '7d', '30d'].map((range) => (
              <button key={range} onClick={() => setTimeRange(range)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${timeRange === range ? 'bg-accent-blue text-white' : 'text-text-secondary hover:text-text-primary'}`}>
                {range}
              </button>
            ))}
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-bg-tertiary border border-white/10 rounded-xl text-text-secondary hover:text-text-primary transition-all">
            <Download size={16} /> Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Jobs Processed" subtitle="Over time">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mockChartData}>
                <defs>
                  <linearGradient id="jobsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} />
                <Area type="monotone" dataKey="jobs" stroke="#10b981" fillOpacity={1} fill="url(#jobsGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Average Latency" subtitle="P50 in milliseconds">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mockChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} />
                <Line type="monotone" dataKey="latency" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Capacity Utilization" subtitle="Network-wide GPU usage" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mockChartData}>
                <defs>
                  <linearGradient id="utilGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} domain={[0, 100]} />
                <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} />
                <Area type="monotone" dataKey="utilization" stroke="#f59e0b" fillOpacity={1} fill="url(#utilGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default AnalyticsPage;
