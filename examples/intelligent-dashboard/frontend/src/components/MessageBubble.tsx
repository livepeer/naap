import React from 'react';
import { User, BrainCircuit, AlertCircle } from 'lucide-react';
import type { ConversationEntry } from '../types';

interface MessageBubbleProps {
  entry: ConversationEntry;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ entry }) => {
  const isUser = entry.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
          <BrainCircuit className="w-4 h-4 text-purple-400" />
        </div>
      )}
      <div
        className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'bg-purple-600 text-white rounded-br-md'
            : entry.error
            ? 'bg-red-500/10 border border-red-500/20 text-red-300 rounded-bl-md'
            : 'bg-white/5 border border-white/10 text-gray-200 rounded-bl-md'
        }`}
      >
        {entry.error && (
          <div className="flex items-center gap-1.5 mb-1">
            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-xs font-medium text-red-400">Error</span>
          </div>
        )}
        {entry.text}
      </div>
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-700 flex items-center justify-center">
          <User className="w-4 h-4 text-gray-300" />
        </div>
      )}
    </div>
  );
};
