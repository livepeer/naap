'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Check, Copy, Terminal, FileCode } from 'lucide-react';

// ---------------------------------------------------------------------------
// Language display config
// ---------------------------------------------------------------------------

const LANG_META: Record<string, { label: string; color: string }> = {
  typescript: { label: 'TypeScript', color: 'text-blue-400' },
  ts: { label: 'TypeScript', color: 'text-blue-400' },
  tsx: { label: 'TSX', color: 'text-blue-400' },
  javascript: { label: 'JavaScript', color: 'text-yellow-400' },
  js: { label: 'JavaScript', color: 'text-yellow-400' },
  jsx: { label: 'JSX', color: 'text-yellow-400' },
  json: { label: 'JSON', color: 'text-amber-400' },
  bash: { label: 'Terminal', color: 'text-emerald-400' },
  sh: { label: 'Shell', color: 'text-emerald-400' },
  shell: { label: 'Shell', color: 'text-emerald-400' },
  zsh: { label: 'Shell', color: 'text-emerald-400' },
  css: { label: 'CSS', color: 'text-purple-400' },
  html: { label: 'HTML', color: 'text-orange-400' },
  sql: { label: 'SQL', color: 'text-cyan-400' },
  prisma: { label: 'Prisma', color: 'text-teal-400' },
  markdown: { label: 'Markdown', color: 'text-gray-400' },
  md: { label: 'Markdown', color: 'text-gray-400' },
  yaml: { label: 'YAML', color: 'text-red-400' },
  yml: { label: 'YAML', color: 'text-red-400' },
  python: { label: 'Python', color: 'text-yellow-300' },
  go: { label: 'Go', color: 'text-cyan-300' },
  rust: { label: 'Rust', color: 'text-orange-300' },
  graphql: { label: 'GraphQL', color: 'text-pink-400' },
  docker: { label: 'Docker', color: 'text-blue-300' },
  dockerfile: { label: 'Dockerfile', color: 'text-blue-300' },
  plaintext: { label: 'Text', color: 'text-gray-400' },
};

function getLangDisplay(lang: string): { label: string; color: string } {
  if (!lang) return { label: '', color: 'text-gray-400' };
  return LANG_META[lang.toLowerCase()] || { label: lang.toUpperCase(), color: 'text-gray-400' };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    if (props.children) {
      return extractText(props.children as React.ReactNode);
    }
  }
  return '';
}

/**
 * Recursively search for a language-* className in the React element tree.
 * MDX may wrap elements through custom component overrides, so the
 * className may not be on the immediate child.
 */
function findLanguageClass(node: React.ReactNode): string {
  if (!React.isValidElement(node)) return '';
  const props = node.props as Record<string, unknown>;
  const cn = typeof props.className === 'string' ? props.className : '';
  if (cn.includes('language-')) return cn;
  // Search children
  if (props.children) {
    const childArray = React.Children.toArray(props.children as React.ReactNode);
    for (const child of childArray) {
      const found = findLanguageClass(child);
      if (found) return found;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Copy Button — always visible, with animated feedback
// ---------------------------------------------------------------------------

function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      // Fallback for older browsers / non-HTTPS
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setState('copied');
      } catch {
        setState('error');
      }
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setState('idle'), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer ${
        state === 'copied'
          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
          : state === 'error'
          ? 'bg-red-500/20 text-red-400'
          : 'bg-white/[0.06] text-gray-400 hover:bg-white/[0.12] hover:text-gray-200 ring-1 ring-white/[0.08] hover:ring-white/[0.16]'
      } ${className}`}
      aria-label={state === 'copied' ? 'Copied!' : 'Copy code'}
    >
      {state === 'copied' ? (
        <>
          <Check size={13} className="shrink-0" />
          <span>Copied!</span>
        </>
      ) : (
        <>
          <Copy size={13} className="shrink-0" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline Code — exported for use in mdx component map
// ---------------------------------------------------------------------------

export function InlineCode({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) {
  // If inside a <pre> block (has language- class), pass through as-is
  if (className?.includes('language-')) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return (
    <code
      {...props}
      className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-mono text-[0.85em] ring-1 ring-primary/20 break-words"
    >
      {children}
    </code>
  );
}

// ---------------------------------------------------------------------------
// CodeBlock (pre) — the main star
// ---------------------------------------------------------------------------

export function CodeBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  // Extract text for copy and detect language — search recursively
  // because MDX wraps <code> through our custom InlineCode component
  const rawText = extractText(children);
  const codeText = rawText.replace(/\n$/, '');

  // Find language class recursively in children tree
  const langClass = findLanguageClass(children as React.ReactNode);
  const lang = langClass.replace(/.*language-/, '').replace(/\s.*/, '').trim();
  const langDisplay = getLangDisplay(lang);
  const isTerminal = ['bash', 'sh', 'shell', 'zsh'].includes(lang.toLowerCase());

  // Count lines
  const lines = codeText.split('\n');
  const showLineNumbers = lines.length > 3 && !isTerminal;

  return (
    <div className="relative my-6 rounded-xl overflow-hidden border border-white/[0.08] bg-[#0d1117] shadow-lg shadow-black/20">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center gap-2">
          {/* Decorative window dots */}
          <div className="flex items-center gap-1.5 mr-2">
            <span className="w-2.5 h-2.5 rounded-full bg-white/[0.06] border border-white/[0.06]" />
            <span className="w-2.5 h-2.5 rounded-full bg-white/[0.06] border border-white/[0.06]" />
            <span className="w-2.5 h-2.5 rounded-full bg-white/[0.06] border border-white/[0.06]" />
          </div>
          {/* Language badge */}
          {langDisplay.label && (
            <span className={`flex items-center gap-1.5 text-xs font-medium ${langDisplay.color}`}>
              {isTerminal ? <Terminal size={12} /> : <FileCode size={12} />}
              {langDisplay.label}
            </span>
          )}
        </div>
        <CopyButton text={codeText} />
      </div>

      {/* Code body */}
      <div className="overflow-x-auto">
        {isTerminal ? (
          /* Terminal-style rendering with $ prompts */
          <div className="p-4">
            {lines.map((line, i) => (
              <div key={i} className="flex text-sm leading-relaxed font-mono">
                {line.startsWith('#') ? (
                  <span className="text-gray-500 italic">{line}</span>
                ) : line.trim() ? (
                  <>
                    <span className="text-emerald-400 select-none mr-2 shrink-0">$</span>
                    <span className="text-gray-200">{line}</span>
                  </>
                ) : (
                  <span>&nbsp;</span>
                )}
              </div>
            ))}
          </div>
        ) : showLineNumbers ? (
          /* Code with line numbers */
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                  <td className="select-none text-right pr-4 pl-4 py-0 text-xs text-gray-600 font-mono w-[1%] whitespace-nowrap border-r border-white/[0.04] leading-[1.7rem]">
                    {i + 1}
                  </td>
                  <td className="pl-4 pr-4 py-0">
                    <span className="text-sm leading-[1.7rem] font-mono text-gray-200 whitespace-pre block">
                      {line || ' '}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          /* Short code block without line numbers */
          <pre
            {...props}
            className="overflow-x-auto p-4 text-sm leading-relaxed font-mono text-gray-200"
          >
            <code className="block">{codeText}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
