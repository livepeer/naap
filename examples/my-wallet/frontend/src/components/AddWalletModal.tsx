/**
 * AddWalletModal - Modal to add a wallet address (from MetaMask or manually)
 */

import React, { useState } from 'react';
import { useWallet } from '../context/WalletContext';

interface AddWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (address: string, chainId: number, label?: string) => Promise<void>;
}

export const AddWalletModal: React.FC<AddWalletModalProps> = ({
  isOpen,
  onClose,
  onAdd,
}) => {
  const { address: connectedAddress, chainId: connectedChainId } = useWallet();
  const [mode, setMode] = useState<'connected' | 'manual'>('connected');
  const [manualAddress, setManualAddress] = useState('');
  const [chainId, setChainId] = useState(42161);
  const [label, setLabel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const addr = mode === 'connected' ? connectedAddress : manualAddress;
      const chain = mode === 'connected' ? (connectedChainId || 42161) : chainId;
      if (!addr) {
        setError('Address is required');
        return;
      }
      await onAdd(addr, chain, label || undefined);
      onClose();
      setManualAddress('');
      setLabel('');
    } catch (err: any) {
      setError(err?.message || 'Failed to add wallet');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="glass-card p-6 w-full max-w-md mx-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Add Wallet</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setMode('connected')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              mode === 'connected' ? 'bg-accent-purple text-white' : 'bg-bg-tertiary text-text-secondary'
            }`}
          >
            Connected Wallet
          </button>
          <button
            onClick={() => setMode('manual')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              mode === 'manual' ? 'bg-accent-purple text-white' : 'bg-bg-tertiary text-text-secondary'
            }`}
          >
            Manual Address
          </button>
        </div>

        {mode === 'connected' ? (
          <div className="p-3 bg-bg-tertiary rounded-lg">
            <p className="text-xs text-text-secondary mb-1">Connected Address</p>
            <p className="font-mono text-sm text-text-primary break-all">
              {connectedAddress || 'No wallet connected'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-sm text-text-secondary">Address</label>
              <input
                type="text"
                value={manualAddress}
                onChange={e => setManualAddress(e.target.value)}
                placeholder="0x..."
                className="w-full mt-1 px-3 py-2 bg-bg-tertiary text-text-primary font-mono text-sm rounded-lg border border-border-primary focus:border-accent-purple outline-none"
              />
            </div>
            <div>
              <label className="text-sm text-text-secondary">Network</label>
              <select
                value={chainId}
                onChange={e => setChainId(Number(e.target.value))}
                className="w-full mt-1 px-3 py-2 bg-bg-tertiary text-text-primary text-sm rounded-lg border border-border-primary focus:border-accent-purple outline-none"
              >
                <option value={42161}>Arbitrum One</option>
                <option value={1}>Ethereum Mainnet</option>
              </select>
            </div>
          </div>
        )}

        <div>
          <label className="text-sm text-text-secondary">Label (optional)</label>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="e.g. Hardware Wallet"
            className="w-full mt-1 px-3 py-2 bg-bg-tertiary text-text-primary text-sm rounded-lg border border-border-primary focus:border-accent-purple outline-none"
            maxLength={50}
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-bg-tertiary text-text-primary rounded-lg hover:bg-bg-secondary text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || (mode === 'connected' && !connectedAddress)}
            className="px-4 py-2 wallet-gradient text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 text-sm"
          >
            {isSubmitting ? 'Adding...' : 'Add Wallet'}
          </button>
        </div>
      </div>
    </div>
  );
};
