/**
 * ConfirmDialog Component
 * 
 * A confirmation dialog for destructive actions.
 */

import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Called when dialog should close */
  onClose: () => void;
  /** Called when action is confirmed */
  onConfirm: () => void;
  /** Dialog title */
  title: string;
  /** Dialog message */
  message: string;
  /** Confirm button text */
  confirmText?: string;
  /** Cancel button text */
  cancelText?: string;
  /** Whether this is a destructive action */
  variant?: 'default' | 'danger';
  /** Whether confirmation is in progress */
  loading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  loading = false,
}) => {
  const Icon = variant === 'danger' ? Trash2 : AlertTriangle;
  const iconColor = variant === 'danger' ? 'text-accent-rose' : 'text-accent-amber';
  const iconBg = variant === 'danger' ? 'bg-accent-rose/10' : 'bg-accent-amber/10';
  const confirmBg = variant === 'danger' 
    ? 'bg-accent-rose hover:bg-accent-rose/90' 
    : 'bg-accent-blue hover:bg-accent-blue/90';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      showCloseButton={false}
    >
      <div className="text-center">
        {/* Icon */}
        <div className={`w-16 h-16 ${iconBg} rounded-full flex items-center justify-center mx-auto mb-4`}>
          <Icon size={32} className={iconColor} />
        </div>

        {/* Content */}
        <h3 className="text-lg font-bold text-text-primary mb-2">
          {title}
        </h3>
        <p className="text-text-secondary text-sm mb-6">
          {message}
        </p>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-3 bg-bg-tertiary text-text-secondary rounded-xl hover:bg-bg-tertiary/80 transition-all font-medium disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 px-4 py-3 ${confirmBg} text-white rounded-xl transition-all font-bold disabled:opacity-50`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing...
              </span>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};
