'use client';

import { useState, useCallback, useRef } from 'react';
import { Check, Copy, Terminal, Puzzle, Zap, Code, Rocket, Package } from 'lucide-react';

// Map of icon names to components - allows passing icon name as string from Server Component
const iconMap = {
  terminal: Terminal,
  puzzle: Puzzle,
  zap: Zap,
  code: Code,
  rocket: Rocket,
  package: Package,
} as const;

type IconName = keyof typeof iconMap;

export function QuickCommand({
  label,
  command,
  icon,
}: {
  label: string;
  command: string;
  icon: IconName;
}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = command;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }, [command]);

  const Icon = iconMap[icon] || Terminal;

  return (
    <div className="group flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:border-primary/30 transition-all">
      <Icon size={18} className="text-primary shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
        <div className="flex items-center gap-2">
          <code className="text-sm font-mono text-foreground truncate">{command}</code>
        </div>
      </div>
      <button
        onClick={handleCopy}
        className={`shrink-0 p-1.5 rounded-md transition-all duration-200 cursor-pointer ${
          copied
            ? 'text-emerald-500 bg-emerald-500/10'
            : 'text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted'
        }`}
        aria-label={copied ? 'Copied!' : 'Copy command'}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
