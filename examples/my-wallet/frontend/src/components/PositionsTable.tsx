/**
 * PositionsTable - Sortable table showing per-orchestrator staking positions
 */

import React, { useState, useMemo } from 'react';
import { formatBalance, formatAddress } from '../lib/utils';

interface Position {
  walletAddressId: string;
  address: string;
  label: string | null;
  chainId: number;
  orchestrator: string | null;
  stakedAmount: string;
  pendingRewards: string;
  pendingFees: string;
  startRound: string | null;
  orchestratorInfo?: {
    name: string | null;
    rewardCut: number;
    feeShare: number;
    totalStake: string;
    isActive: boolean;
  };
}

interface PositionsTableProps {
  positions: Position[];
  isLoading?: boolean;
  onSelectPosition?: (position: Position) => void;
}

type SortKey = 'orchestrator' | 'stakedAmount' | 'pendingRewards' | 'rewardCut' | 'feeShare';

export const PositionsTable: React.FC<PositionsTableProps> = ({
  positions,
  isLoading,
  onSelectPosition,
}) => {
  const [sortKey, setSortKey] = useState<SortKey>('stakedAmount');
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => {
    return [...positions].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'orchestrator':
          cmp = (a.orchestrator || '').localeCompare(b.orchestrator || '');
          break;
        case 'stakedAmount':
          cmp = parseFloat(a.stakedAmount || '0') - parseFloat(b.stakedAmount || '0');
          break;
        case 'pendingRewards':
          cmp = parseFloat(a.pendingRewards || '0') - parseFloat(b.pendingRewards || '0');
          break;
        case 'rewardCut':
          cmp = (a.orchestratorInfo?.rewardCut || 0) - (b.orchestratorInfo?.rewardCut || 0);
          break;
        case 'feeShare':
          cmp = (a.orchestratorInfo?.feeShare || 0) - (b.orchestratorInfo?.feeShare || 0);
          break;
      }
      return sortDesc ? -cmp : cmp;
    });
  }, [positions, sortKey, sortDesc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const SortIcon = ({ active, desc }: { active: boolean; desc: boolean }) => (
    <span className={`ml-1 ${active ? 'text-accent-purple' : 'text-text-secondary/40'}`}>
      {active && desc ? '↓' : active && !desc ? '↑' : '↕'}
    </span>
  );

  if (isLoading) {
    return (
      <div className="glass-card p-6 animate-pulse">
        <div className="h-6 bg-bg-tertiary rounded w-48 mb-4" />
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 bg-bg-tertiary rounded mb-2" />
        ))}
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="glass-card p-6 text-center text-text-secondary">
        No staking positions found. Connect a wallet and stake to an orchestrator.
      </div>
    );
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="p-4 border-b border-border-primary">
        <h3 className="text-lg font-semibold text-text-primary">Staking Positions</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-primary text-text-secondary text-sm">
              <th className="px-4 py-3 text-left">Wallet</th>
              <th className="px-4 py-3 text-left cursor-pointer" onClick={() => handleSort('orchestrator')}>
                Orchestrator <SortIcon active={sortKey === 'orchestrator'} desc={sortDesc} />
              </th>
              <th className="px-4 py-3 text-right cursor-pointer" onClick={() => handleSort('stakedAmount')}>
                Staked <SortIcon active={sortKey === 'stakedAmount'} desc={sortDesc} />
              </th>
              <th className="px-4 py-3 text-right cursor-pointer" onClick={() => handleSort('rewardCut')}>
                Reward Cut <SortIcon active={sortKey === 'rewardCut'} desc={sortDesc} />
              </th>
              <th className="px-4 py-3 text-right cursor-pointer" onClick={() => handleSort('feeShare')}>
                Fee Share <SortIcon active={sortKey === 'feeShare'} desc={sortDesc} />
              </th>
              <th className="px-4 py-3 text-right cursor-pointer" onClick={() => handleSort('pendingRewards')}>
                Rewards <SortIcon active={sortKey === 'pendingRewards'} desc={sortDesc} />
              </th>
              <th className="px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(pos => (
              <tr
                key={pos.walletAddressId}
                className="border-b border-border-primary/50 hover:bg-bg-tertiary/50 transition-colors cursor-pointer"
                onClick={() => onSelectPosition?.(pos)}
              >
                <td className="px-4 py-3">
                  <span className="font-mono text-sm text-text-primary">
                    {pos.label || formatAddress(pos.address)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {pos.orchestrator ? (
                    <span className="font-mono text-sm text-text-primary">
                      {pos.orchestratorInfo?.name || formatAddress(pos.orchestrator)}
                    </span>
                  ) : (
                    <span className="text-text-secondary text-sm">Not delegated</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm text-accent-purple">
                  {formatBalance(pos.stakedAmount)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm text-text-primary">
                  {pos.orchestratorInfo ? `${(pos.orchestratorInfo.rewardCut / 10000).toFixed(2)}%` : '-'}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm text-text-primary">
                  {pos.orchestratorInfo ? `${(pos.orchestratorInfo.feeShare / 10000).toFixed(2)}%` : '-'}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm text-accent-emerald">
                  {formatBalance(pos.pendingRewards)}
                </td>
                <td className="px-4 py-3 text-center">
                  {pos.orchestratorInfo?.isActive ? (
                    <span className="text-xs bg-accent-emerald/20 text-accent-emerald px-2 py-0.5 rounded-full">Active</span>
                  ) : pos.orchestrator ? (
                    <span className="text-xs bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded-full">Inactive</span>
                  ) : (
                    <span className="text-xs bg-bg-tertiary text-text-secondary px-2 py-0.5 rounded-full">None</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
