'use client';

import React from 'react';

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

export function HeadingWithAnchor({
  level,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { level: number }) {
  const text = extractText(children);
  const id =
    props.id ||
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

  const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

  return (
    <Tag id={id} className="group scroll-mt-24" {...props}>
      <a
        href={`#${id}`}
        className="no-underline hover:underline decoration-primary/40"
      >
        {children}
        <span className="ml-2 opacity-0 group-hover:opacity-100 text-primary/60 transition-opacity text-[0.7em] font-normal">
          #
        </span>
      </a>
    </Tag>
  );
}
