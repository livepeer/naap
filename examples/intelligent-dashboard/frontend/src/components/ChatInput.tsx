import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles } from 'lucide-react';

interface ChatInputProps {
  onSubmit: (question: string) => void;
  disabled?: boolean;
  examplePrompts?: string[];
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSubmit, disabled, examplePrompts }) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue('');
  };

  return (
    <div className="space-y-3">
      {examplePrompts && examplePrompts.length > 0 && !disabled && (
        <div className="flex flex-wrap gap-2">
          {examplePrompts.map((prompt) => (
            <button
              key={prompt}
              onClick={() => onSubmit(prompt)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-500/10 text-purple-300 border border-purple-500/20 rounded-full hover:bg-purple-500/20 transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              {prompt}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="Ask about orchestrator performance..."
          disabled={disabled}
          className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/10 transition-all disabled:opacity-40"
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          className="p-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
