import { AlertTriangle } from 'lucide-react';

const DISCORD_URL = 'https://discord.com/channels/423160867534929930/1470881817291915538';

export function BetaBanner() {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2 text-center text-[13px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border-b border-amber-500/30">
      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
      <p className="min-w-0">
        <span className="font-semibold">This app is currently in beta.</span>{' '}
        We&apos;re actively looking for feedback — join the{' '}
        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold underline underline-offset-2 hover:opacity-80"
        >
          Livepeer Discord
        </a>{' '}
        to share yours.
      </p>
    </div>
  );
}
