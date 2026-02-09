'use client';

import { useEffect, useState } from 'react';

interface TocHeading {
  id: string;
  text: string;
  level: number;
}

interface DocsTocProps {
  headings: TocHeading[];
}

export function DocsToc({ headings }: DocsTocProps) {
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      {
        rootMargin: '-80px 0px -80% 0px',
        threshold: 0,
      }
    );

    for (const heading of headings) {
      const el = document.getElementById(heading.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <div className="sticky top-20">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        On this page
      </p>
      <nav className="space-y-1">
        {headings.map((heading) => (
          <a
            key={heading.id}
            href={`#${heading.id}`}
            className={`block text-sm transition-colors py-1 ${
              heading.level === 3 ? 'pl-4' : heading.level === 4 ? 'pl-8' : ''
            } ${
              activeId === heading.id
                ? 'text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById(heading.id);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth' });
                history.replaceState(null, '', `#${heading.id}`);
                setActiveId(heading.id);
              }
            }}
          >
            {heading.text}
          </a>
        ))}
      </nav>
    </div>
  );
}
