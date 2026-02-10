'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, MessageSquare, Key, Blocks } from 'lucide-react';

const adminTabs = [
  { name: 'Users', href: '/admin/users', icon: Users },
  { name: 'Plugins', href: '/admin/plugins', icon: Blocks },
  { name: 'Feedback', href: '/admin/feedback', icon: MessageSquare },
  { name: 'Secrets', href: '/admin/secrets', icon: Key },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 border-b border-border mb-6 pb-0">
      {adminTabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
            }`}
          >
            <Icon size={16} />
            {tab.name}
          </Link>
        );
      })}
    </div>
  );
}
