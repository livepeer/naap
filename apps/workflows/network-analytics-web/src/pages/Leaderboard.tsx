import React from 'react';
import { Trophy, Medal, Star, TrendingUp, Cpu } from 'lucide-react';
import { Card, Badge } from '@naap/ui';

const mockLeaderboard = [
  { rank: 1, name: 'GPU Fleet Alpha', address: '0x1234...5678', earnings: 12450.50, jobs: 145230, successRate: 99.8, change: 2 },
  { rank: 2, name: 'Neural Compute Co', address: '0xabcd...ef12', earnings: 10890.25, jobs: 132450, successRate: 99.6, change: -1 },
  { rank: 3, name: 'Render Core', address: '0x7890...abcd', earnings: 9875.00, jobs: 128900, successRate: 99.9, change: 1 },
  { rank: 4, name: 'Decentralized AI', address: '0x4567...8901', earnings: 8540.75, jobs: 115600, successRate: 99.2, change: 0 },
  { rank: 5, name: 'Compute Protocol', address: '0x2345...6789', earnings: 7250.00, jobs: 98450, successRate: 99.4, change: 3 },
];

const RankBadge: React.FC<{ rank: number }> = ({ rank }) => {
  if (rank === 1) return <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-yellow-400 to-amber-500 flex items-center justify-center"><Trophy size={20} className="text-white" /></div>;
  if (rank === 2) return <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-gray-300 to-gray-400 flex items-center justify-center"><Medal size={20} className="text-white" /></div>;
  if (rank === 3) return <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-600 to-orange-700 flex items-center justify-center"><Star size={20} className="text-white" /></div>;
  return <div className="w-10 h-10 rounded-xl bg-bg-tertiary flex items-center justify-center font-mono font-bold text-text-secondary">{rank}</div>;
};

export const LeaderboardPage: React.FC = () => {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-outfit font-bold text-text-primary">Leaderboard</h1>
        <p className="text-text-secondary mt-1">Top performing orchestrators this round</p>
      </div>

      <Card>
        <div className="space-y-2">
          {/* Header */}
          <div className="grid grid-cols-12 gap-4 px-4 py-3 text-xs font-bold text-text-secondary uppercase tracking-wider border-b border-white/5">
            <div className="col-span-1">Rank</div>
            <div className="col-span-4">Operator</div>
            <div className="col-span-2 text-right">Earnings</div>
            <div className="col-span-2 text-right">Jobs</div>
            <div className="col-span-2 text-right">Success Rate</div>
            <div className="col-span-1 text-right">Trend</div>
          </div>

          {/* Rows */}
          {mockLeaderboard.map((entry) => (
            <div key={entry.rank} className="grid grid-cols-12 gap-4 px-4 py-4 rounded-xl hover:bg-bg-tertiary/50 transition-all cursor-pointer items-center">
              <div className="col-span-1"><RankBadge rank={entry.rank} /></div>
              <div className="col-span-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-accent-blue to-purple-500 flex items-center justify-center">
                  <Cpu size={18} className="text-white" />
                </div>
                <div>
                  <p className="font-bold text-text-primary">{entry.name}</p>
                  <p className="text-xs font-mono text-text-secondary">{entry.address}</p>
                </div>
              </div>
              <div className="col-span-2 text-right font-mono font-bold text-accent-emerald">${entry.earnings.toLocaleString()}</div>
              <div className="col-span-2 text-right font-mono text-text-primary">{entry.jobs.toLocaleString()}</div>
              <div className="col-span-2 text-right"><Badge variant="emerald">{entry.successRate}%</Badge></div>
              <div className="col-span-1 text-right">
                {entry.change > 0 && <span className="text-accent-emerald flex items-center justify-end gap-1"><TrendingUp size={14} />+{entry.change}</span>}
                {entry.change < 0 && <span className="text-accent-rose flex items-center justify-end gap-1"><TrendingUp size={14} className="rotate-180" />{entry.change}</span>}
                {entry.change === 0 && <span className="text-text-secondary">-</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

export default LeaderboardPage;
