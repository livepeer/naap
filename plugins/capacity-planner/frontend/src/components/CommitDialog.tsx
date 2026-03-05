import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Minus, Plus, X } from 'lucide-react';

interface CommitDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCommit: (gpuCount: number) => void;
  onWithdraw?: () => void;
  existingCount?: number;
  maxGpus?: number;
  anchorRect?: DOMRect | null;
}

export const CommitDialog: React.FC<CommitDialogProps> = ({
  isOpen,
  onClose,
  onCommit,
  onWithdraw,
  existingCount,
  maxGpus,
  anchorRect,
}) => {
  const [count, setCount] = useState(existingCount || 1);
  const dialogRef = useRef<HTMLDivElement>(null);
  const isUpdate = existingCount != null && existingCount > 0;

  useEffect(() => {
    setCount(existingCount || 1);
  }, [existingCount, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  const decrement = () => setCount((c) => Math.max(1, c - 1));
  const increment = () => setCount((c) => Math.min(maxGpus || 999, c + 1));

  const style: React.CSSProperties = {};
  if (anchorRect) {
    style.position = 'fixed';
    style.top = anchorRect.bottom + 8;
    style.left = Math.max(8, anchorRect.left + anchorRect.width / 2 - 120);
    style.zIndex = 9999;
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={dialogRef}
          key="commit-dialog"
          initial={{ opacity: 0, y: -4, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.96 }}
          transition={{ duration: 0.15 }}
          style={style}
          className={`${anchorRect ? '' : 'absolute right-0 top-full mt-2 z-50'} w-60 bg-bg-secondary border border-[var(--border-color)] rounded-xl shadow-2xl p-4`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
              {isUpdate ? 'Update Commitment' : 'GPUs to Provide'}
            </span>
          <button
            onClick={onClose}
            aria-label="Close commit dialog"
            className="p-1 rounded-md hover:bg-white/5 text-text-secondary"
          >
              <X size={12} />
            </button>
          </div>

          <div className="flex items-center justify-center gap-3 mb-4">
          <button
            onClick={decrement}
            disabled={count <= 1}
            aria-label="Decrease GPU count"
            className="w-8 h-8 rounded-lg bg-bg-tertiary border border-[var(--border-color)] flex items-center justify-center text-text-secondary hover:text-text-primary hover:border-accent-blue disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
              <Minus size={14} />
            </button>
          <input
            type="number"
            min={1}
            max={maxGpus || 999}
            value={count}
            aria-label="GPU count"
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (Number.isFinite(v) && v >= 1) setCount(Math.min(v, maxGpus || 999));
              }}
              className="w-16 h-10 text-center text-lg font-bold text-text-primary bg-bg-tertiary border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-accent-emerald [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          <button
            onClick={increment}
            aria-label="Increase GPU count"
            className="w-8 h-8 rounded-lg bg-bg-tertiary border border-[var(--border-color)] flex items-center justify-center text-text-secondary hover:text-text-primary hover:border-accent-blue transition-all"
          >
              <Plus size={14} />
            </button>
          </div>

          <button
            onClick={() => {
              onCommit(count);
              onClose();
            }}
            className="w-full py-2 rounded-xl text-sm font-semibold bg-accent-emerald text-white shadow-lg shadow-accent-emerald/20 hover:bg-accent-emerald/90 transition-all mb-2"
          >
            {isUpdate ? 'Update' : 'Commit'}
          </button>

          {isUpdate && onWithdraw && (
            <button
              onClick={() => {
                onWithdraw();
                onClose();
              }}
              className="w-full py-2 rounded-xl text-xs font-medium text-accent-rose hover:bg-accent-rose/10 transition-all"
            >
              Withdraw Commitment
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
