import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ThumbsUp,
  MessageSquare,
  Send,
  Cpu,
  Calendar,
  DollarSign,
  Clock,
  HardDrive,
  Monitor,
  Layers,
  User,
} from 'lucide-react';
import { Badge } from '@naap/ui';
import type { CapacityRequest, RequestComment } from '../types';
import { RiskIndicator } from './RiskIndicator';
import { formatDate } from '../utils';

interface RequestDetailModalProps {
  request: CapacityRequest;
  isOpen: boolean;
  onClose: () => void;
  onThumbsUp: (request: CapacityRequest) => void;
  onAddComment: (requestId: string, comment: RequestComment) => void;
  hasCommitted: boolean;
}

export const RequestDetailModal: React.FC<RequestDetailModalProps> = ({
  request,
  isOpen,
  onClose,
  onThumbsUp,
  onAddComment,
  hasCommitted,
}) => {
  const [commentText, setCommentText] = useState('');

  if (!isOpen) return null;

  const handleSubmitComment = () => {
    if (!commentText.trim()) return;
    const comment: RequestComment = {
      id: `cmt-${Date.now()}`,
      author: 'You',
      text: commentText.trim(),
      timestamp: new Date().toISOString(),
    };
    onAddComment(request.id, comment);
    setCommentText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitComment();
    }
  };

  const specs = [
    { icon: <Cpu size={14} />, label: 'GPU Model', value: request.gpuModel },
    { icon: <HardDrive size={14} />, label: 'VRAM', value: `${request.vram} GB` },
    { icon: <Monitor size={14} />, label: 'OS', value: request.osVersion },
    { icon: <Layers size={14} />, label: 'CUDA', value: request.cudaVersion },
    { icon: <Cpu size={14} />, label: 'Count', value: `${request.count} GPU${request.count > 1 ? 's' : ''}` },
    { icon: <Layers size={14} />, label: 'Pipeline', value: request.pipeline },
    { icon: <Calendar size={14} />, label: 'Start', value: formatDate(request.startDate) },
    { icon: <Calendar size={14} />, label: 'End', value: formatDate(request.endDate) },
    { icon: <Clock size={14} />, label: 'Valid Until', value: formatDate(request.validUntil) },
    { icon: <DollarSign size={14} />, label: 'Rate', value: `$${request.hourlyRate.toFixed(2)}/hr` },
  ];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-3xl bg-bg-secondary border border-[var(--border-color)] rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between p-6 border-b border-[var(--border-color)]">
            <div className="flex-1 min-w-0 mr-4">
              <h2 className="text-xl font-bold text-text-primary leading-tight">
                {request.requesterName}
              </h2>
              <p className="text-sm text-text-secondary font-mono mt-1">
                {request.requesterAccount}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant={request.status === 'active' ? 'emerald' : 'secondary'}>
                  {request.status}
                </Badge>
                <Badge variant="blue">{request.gpuModel} x {request.count}</Badge>
                <RiskIndicator level={request.riskLevel} size="md" />
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
            >
              <X size={20} />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {/* Specs Grid */}
            <div className="p-6 border-b border-[var(--border-color)]">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
                Specifications
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {specs.map((spec) => (
                  <div key={spec.label} className="bg-bg-tertiary rounded-xl p-3">
                    <div className="flex items-center gap-1.5 text-text-secondary mb-1">
                      {spec.icon}
                      <span className="text-[10px] uppercase tracking-wider">{spec.label}</span>
                    </div>
                    <div className="text-sm font-bold text-text-primary truncate">{spec.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Reason */}
            <div className="p-6 border-b border-[var(--border-color)]">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                Reason
              </h3>
              <p className="text-sm text-text-primary leading-relaxed">{request.reason}</p>
            </div>

            {/* Soft Commitments */}
            <div className="p-6 border-b border-[var(--border-color)]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Soft Commitments ({request.softCommits.length})
                </h3>
                <button
                  onClick={() => onThumbsUp(request)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                    hasCommitted
                      ? 'bg-accent-emerald/20 text-accent-emerald border border-accent-emerald/30'
                      : 'bg-accent-emerald text-white shadow-lg shadow-accent-emerald/20 hover:bg-accent-emerald/90'
                  }`}
                >
                  <ThumbsUp size={15} className={hasCommitted ? 'fill-current' : ''} />
                  {hasCommitted ? 'Committed' : 'I can provide'}
                </button>
              </div>
              {request.softCommits.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {request.softCommits.map((commit) => (
                    <div
                      key={commit.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-emerald/10 border border-accent-emerald/20 rounded-full"
                    >
                      <div className="w-5 h-5 rounded-full bg-accent-emerald/30 flex items-center justify-center">
                        <User size={10} className="text-accent-emerald" />
                      </div>
                      <span className="text-xs font-medium text-accent-emerald">
                        {commit.userName}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-secondary italic">
                  No commitments yet. Be the first to support this request!
                </p>
              )}
            </div>

            {/* Comments */}
            <div className="p-6">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <MessageSquare size={13} />
                Questions & Comments ({request.comments.length})
              </h3>

              {/* Comment thread */}
              {request.comments.length > 0 ? (
                <div className="space-y-3 mb-4">
                  {request.comments.map((comment) => (
                    <div key={comment.id} className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-accent-blue/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[10px] font-bold text-accent-blue">
                          {comment.author.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-text-primary">
                            {comment.author}
                          </span>
                          <span className="text-[10px] text-text-secondary">
                            {formatDate(comment.timestamp)}
                          </span>
                        </div>
                        <p className="text-sm text-text-secondary leading-relaxed">
                          {comment.text}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-secondary italic mb-4">
                  No comments yet. Start the conversation!
                </p>
              )}

              {/* Comment input */}
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask a question or leave a comment..."
                    rows={2}
                    className="w-full bg-bg-tertiary border border-[var(--border-color)] rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent-blue transition-colors resize-none placeholder:text-text-secondary/50"
                  />
                </div>
                <button
                  onClick={handleSubmitComment}
                  disabled={!commentText.trim()}
                  className="self-end px-4 py-2.5 bg-accent-blue text-white rounded-xl font-medium text-sm hover:bg-accent-blue/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
