'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Rocket,
  BookOpen,
  Map,
  Code,
  FileCode,
  Users,
  ChevronDown,
  File,
} from 'lucide-react';
import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Icon resolver
// ---------------------------------------------------------------------------

const iconMap: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Rocket,
  BookOpen,
  Map,
  Code,
  FileCode,
  Users,
  File,
};

function SectionIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = name ? iconMap[name] || File : File;
  return <Icon size={16} className={className} />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DocsSidebarProps {
  navigation: NavSection[];
  className?: string;
}

export function DocsSidebar({ navigation, className = '' }: DocsSidebarProps) {
  const pathname = usePathname();

  return (
    <nav className={`space-y-1 ${className}`}>
      {navigation.map((section) => (
        <SidebarSection
          key={section.title}
          section={section}
          pathname={pathname}
        />
      ))}
    </nav>
  );
}

function SidebarSection({ section, pathname }: { section: NavSection; pathname: string }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors group"
      >
        <SectionIcon name={section.icon} className="text-muted-foreground group-hover:text-foreground transition-colors" />
        <span className="flex-1 text-left">{section.title}</span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground/50 transition-transform duration-200 ${
            expanded ? '' : '-rotate-90'
          }`}
        />
      </button>

      {expanded && (
        <div className="ml-3 pl-3 border-l border-border space-y-0.5 mt-1">
          {section.items.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'text-primary font-medium bg-primary/5 border-l-2 border-primary -ml-[13px] pl-[23px]'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {item.title}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
