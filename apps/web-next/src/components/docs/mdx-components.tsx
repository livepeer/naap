// This file is a SERVER-COMPATIBLE module — no 'use client' directive.
// It imports client components (CodeBlock, InlineCode, etc.) and returns
// a component map that MDXRemote can use in RSC.

import React from 'react';
import { CodeBlock, InlineCode } from './code-block';
import { CalloutBlock } from './callout';
import { HeadingWithAnchor } from './heading-anchor';

// ---------------------------------------------------------------------------
// Component map for MDX
// ---------------------------------------------------------------------------

export function getMdxComponents() {
  return {
    h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={1} {...props} />,
    h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={2} {...props} />,
    h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={3} {...props} />,
    h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={4} {...props} />,
    pre: CodeBlock,
    code: InlineCode,
    Callout: CalloutBlock,
    // Enhanced links
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        href={href}
        {...props}
        className="text-primary hover:text-primary/80 underline decoration-primary/30 hover:decoration-primary underline-offset-2 transition-colors"
        {...(href?.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {children}
      </a>
    ),
    // Enhanced images
    img: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={alt || ''}
        {...props}
        className="rounded-xl border border-border my-6"
      />
    ),
    // Enhanced blockquote
    blockquote: ({ children, ...props }: React.BlockquoteHTMLAttributes<HTMLQuoteElement>) => (
      <blockquote
        {...props}
        className="border-l-4 border-primary/30 pl-4 my-6 text-muted-foreground italic"
      >
        {children}
      </blockquote>
    ),
    // Enhanced table
    table: ({ children, ...props }: React.TableHTMLAttributes<HTMLTableElement>) => (
      <div className="my-6 overflow-x-auto rounded-xl border border-border">
        <table {...props} className="w-full text-sm">
          {children}
        </table>
      </div>
    ),
    th: ({ children, ...props }: React.ThHTMLAttributes<HTMLTableHeaderCellElement>) => (
      <th {...props} className="text-left p-3 font-semibold border-b border-border bg-muted/30">
        {children}
      </th>
    ),
    td: ({ children, ...props }: React.TdHTMLAttributes<HTMLTableDataCellElement>) => (
      <td {...props} className="p-3 border-b border-border last:border-0">
        {children}
      </td>
    ),
    // Enhanced lists
    ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
      <ul {...props} className="my-4 space-y-1.5 list-disc pl-6 marker:text-muted-foreground/50">
        {children}
      </ul>
    ),
    ol: ({ children, ...props }: React.OlHTMLAttributes<HTMLOListElement>) => (
      <ol {...props} className="my-4 space-y-1.5 list-decimal pl-6 marker:text-muted-foreground/50">
        {children}
      </ol>
    ),
    li: ({ children, ...props }: React.LiHTMLAttributes<HTMLLIElement>) => (
      <li {...props} className="pl-1 text-foreground/90 leading-relaxed">
        {children}
      </li>
    ),
    // Enhanced paragraph
    p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p {...props} className="my-4 leading-7 text-foreground/90">
        {children}
      </p>
    ),
    // Enhanced hr
    hr: () => <hr className="my-8 border-border" />,
  };
}
