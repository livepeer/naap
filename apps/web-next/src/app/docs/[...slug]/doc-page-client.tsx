'use client';

import { DocsToc } from '@/components/docs/docs-toc';

interface TocHeading {
  id: string;
  text: string;
  level: number;
}

interface NavItem {
  title: string;
  href: string;
  order: number;
  icon?: string;
}

interface NavSection {
  title: string;
  order: number;
  icon?: string;
  items: NavItem[];
}

interface DocPageClientProps {
  headings: TocHeading[];
  navigation: NavSection[];
}

export function DocPageClient({ headings }: DocPageClientProps) {
  return (
    <aside className="hidden xl:block w-56 shrink-0">
      <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto py-10 px-4">
        <DocsToc headings={headings} />
      </div>
    </aside>
  );
}
