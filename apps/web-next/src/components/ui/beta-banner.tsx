import { ExternalLink } from 'lucide-react';

const DISCORD_URL = 'https://discord.gg/livepeer';

export function BetaBanner() {
  return (
    <div className="w-full bg-amber-500/10 border-b border-amber-500/20">
      <div className="flex items-center justify-center gap-x-2 px-4 py-1.5 text-center">
        <span className="text-xs text-amber-700 dark:text-amber-400">
          This app is in beta &mdash; we&apos;re actively shaping it with community feedback.
        </span>
        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300 underline underline-offset-2 decoration-amber-500/40 hover:decoration-amber-500 transition-colors whitespace-nowrap"
        >
          Join us on Discord
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
