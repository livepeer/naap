import React, { useState } from 'react';
import { Send, Sparkles } from 'lucide-react';

const SUGGESTIONS = ['Top spending?', 'Any duplicates?', 'Travel this quarter?', 'Compare to last month'];

export const AskBar: React.FC<{
  onAsk: (question: string) => void;
  loading: boolean;
}> = ({ onAsk, loading }) => {
  const [question, setQuestion] = useState('');

  const handleSubmit = () => {
    if (!question.trim() || loading) return;
    onAsk(question.trim());
    setQuestion('');
  };

  return (
    <div className="mb-4">
      <div className="bg-card border border-border rounded-xl p-1.5 flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 pl-3">
          <Sparkles className="w-4 h-4 text-primary shrink-0" />
          <input
            type="text" value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="Ask about your expenses..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none py-2.5"
            disabled={loading}
          />
        </div>
        <button onClick={handleSubmit} disabled={loading || !question.trim()}
          className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40 transition-opacity">
          {loading ? <span className="flex gap-1"><span className="w-1 h-1 bg-primary-foreground rounded-full animate-bounce" style={{animationDelay:'0ms'}}/><span className="w-1 h-1 bg-primary-foreground rounded-full animate-bounce" style={{animationDelay:'150ms'}}/><span className="w-1 h-1 bg-primary-foreground rounded-full animate-bounce" style={{animationDelay:'300ms'}}/></span> : 'Ask'}
        </button>
      </div>
      {!loading && (
        <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1">
          {SUGGESTIONS.map(s => (
            <button key={s} onClick={() => onAsk(s)}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-muted/50 text-muted-foreground hover:text-foreground border border-border/50 whitespace-nowrap shrink-0 transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
