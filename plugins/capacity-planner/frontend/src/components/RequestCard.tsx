import React from 'react';
import { motion } from 'framer-motion';
import {
  ThumbsUp,
  Clock,
  MessageSquare,
  DollarSign,
  Cpu,
  Calendar,
  AlertTriangle,
} from 'lucide-react';
import { Badge } from '@naap/ui';
import type { CapacityRequest } from '../types';
import { RiskIndicator } from './RiskIndicator';
import { formatDate, formatRelativeDate } from '../utils';

interface RequestCardProps {
  request: CapacityRequest;
  onSelect: (request: CapacityRequest) => void;
  onThumbsUp: (request: CapacityRequest) => void;
  hasCommitted: boolean;
}

export const RequestCard: React.FC<RequestCardProps> = ({
  request,
  onSelect,
  onThumbsUp,
  hasCommitted,
}) => {
  const isExpiringSoon =
    new Date(request.validUntil).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="glass-card p-5 hover:border-accent-blue/30 transition-all cursor-pointer group flex flex-col"
      onClick={() => onSelect(request)}
    >
      {/* Header: Requester info */}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1 mr-3">
          <h3 className="font-bold text-text-primary text-sm leading-tight truncate group-hover:text-accent-blue transition-colors">
            {request.requesterName}
          </h3>
          <p className="text-xs text-text-secondary font-mono mt-0.5 truncate">
            {request.requesterAccount}
          </p>
        </div>
        <Badge variant={request.status === 'active' ? 'emerald' : 'secondary'}>
          {request.status}
        </Badge>
      </div>

      {/* GPU + Count badge row */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-accent-blue/10 text-accent-blue rounded-lg text-xs font-semibold">
          <Cpu size={12} />
          {request.gpuModel}
        </div>
        <Badge variant="amber">{request.count} GPU{request.count > 1 ? 's' : ''}</Badge>
        <Badge variant="blue">{request.vram}GB VRAM</Badge>
      </div>

      {/* Pipeline */}
      <div className="mb-2">
        <span className="text-xs text-text-secondary">Pipeline: </span>
        <span className="text-xs font-semibold text-text-primary">{request.pipeline}</span>
      </div>

      {/* Reason (truncated) */}
      <p className="text-xs text-text-secondary mb-3 line-clamp-2 flex-1">
        {request.reason}
      </p>

      {/* Price & Risk row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1 text-accent-emerald">
          <DollarSign size={13} />
          <span className="text-sm font-bold">${request.hourlyRate.toFixed(2)}</span>
          <span className="text-xs text-text-secondary">/hr</span>
        </div>
        <div className="flex items-center gap-1">
          <AlertTriangle size={11} className="text-text-secondary" />
          <RiskIndicator level={request.riskLevel} size="sm" />
        </div>
      </div>

      {/* Date range */}
      <div className="flex items-center gap-1.5 text-xs text-text-secondary mb-3">
        <Calendar size={11} />
        <span>{formatDate(request.startDate)} - {formatDate(request.endDate)}</span>
      </div>

      {/* Footer: Engagement stats + Thumb up */}
      <div className="flex items-center justify-between pt-3 border-t border-[var(--border-color)]">
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onThumbsUp(request);
            }}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              hasCommitted
                ? 'bg-accent-emerald/20 text-accent-emerald'
                : 'bg-white/5 text-text-secondary hover:bg-accent-emerald/10 hover:text-accent-emerald'
            }`}
          >
            <ThumbsUp size={13} className={hasCommitted ? 'fill-current' : ''} />
            <span>{request.softCommits.length}</span>
          </button>
          <div className="flex items-center gap-1 text-text-secondary">
            <MessageSquare size={13} />
            <span className="text-xs">{request.comments.length}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Clock size={11} className={isExpiringSoon ? 'text-accent-rose' : 'text-text-secondary'} />
          <span
            className={`text-xs font-medium ${
              isExpiringSoon ? 'text-accent-rose' : 'text-text-secondary'
            }`}
          >
            {formatRelativeDate(request.validUntil)}
          </span>
        </div>
      </div>
    </motion.div>
  );
};
