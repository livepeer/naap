/**
 * TxConfirmationDialog - Gas estimate + confirm button before MetaMask signing
 */

import React from 'react';

interface TxConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  details?: { label: string; value: string }[];
  confirmLabel?: string;
  isProcessing?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const TxConfirmationDialog: React.FC<TxConfirmationDialogProps> = ({
  isOpen,
  title,
  description,
  details = [],
  confirmLabel = 'Confirm',
  isProcessing = false,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="glass-card p-6 w-full max-w-sm mx-4 space-y-4">
        <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
        <p className="text-sm text-text-secondary">{description}</p>

        {details.length > 0 && (
          <div className="space-y-2 p-3 bg-bg-tertiary rounded-lg">
            {details.map(d => (
              <div key={d.label} className="flex justify-between text-sm">
                <span className="text-text-secondary">{d.label}</span>
                <span className="font-mono text-text-primary">{d.value}</span>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-text-secondary">
          You will be asked to confirm this transaction in your wallet.
        </p>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isProcessing}
            className="px-4 py-2 bg-bg-tertiary text-text-primary rounded-lg hover:bg-bg-secondary text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isProcessing}
            className="px-4 py-2 wallet-gradient text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 text-sm"
          >
            {isProcessing ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
