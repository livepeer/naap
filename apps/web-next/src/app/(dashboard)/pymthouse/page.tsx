import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { getPymthouseMarketplaceUrl } from '@/lib/pymthouse-flow2';

export const metadata = {
  title: 'PymtHouse',
};

export default function PymtHousePage() {
  const marketplaceUrl = getPymthouseMarketplaceUrl();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">PymtHouse</h1>
        <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
          Billing providers and app plans are listed on PymtHouse. Subscribe there with your PymtHouse
          account, then use NaaP developer tools with a linked billing provider where supported.
        </p>
      </div>

      {marketplaceUrl ? (
        <a
          href={marketplaceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm font-medium hover:bg-muted/60 transition-colors"
        >
          <ExternalLink className="h-4 w-4 shrink-0" />
          Open PymtHouse marketplace
        </a>
      ) : (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-200/90">
          Set <code className="rounded bg-background/50 px-1 py-0.5">PYMTHOUSE_MARKETPLACE_URL</code> or{' '}
          <code className="rounded bg-background/50 px-1 py-0.5">PYMTHOUSE_ISSUER_URL</code> to enable the
          marketplace link.
        </div>
      )}

      <section className="space-y-3 text-sm text-muted-foreground border-t border-border pt-8">
        <h2 className="text-foreground font-medium">Integration notes</h2>
        <ul className="list-disc pl-5 space-y-2 leading-relaxed">
          <li>
            Plan builder data from NaaP:{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/v1/pymthouse/capabilities/catalog</code>,{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/v1/pymthouse/sla/summary</code>,{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/v1/pymthouse/network/price</code>.
          </li>
          <li>
            Subscriptions today are created in PymtHouse with an interactive session; there is no NaaP-only
            server-to-server subscribe API on PymtHouse yet.
          </li>
          <li>
            After subscribe, tenant user provisioning and tokens use PymtHouse{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/v1/apps/&#123;app_id&#125;/users</code> and{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">.../token</code> with a confidential OAuth client
            where configured.
          </li>
        </ul>
        <p>
          <Link href="/plugins/developer-api" className="text-primary hover:underline">
            Developer API
          </Link>{' '}
          — create keys and choose a billing provider.
        </p>
      </section>
    </div>
  );
}
