import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { MDXRemote } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { getDocBySlug, getAllDocSlugs, getNavigation, extractHeadings, getPrevNext, getFirstDocInSection } from '@/lib/docs/content';
import { DocsSidebar } from '@/components/docs/docs-sidebar';
import { getMdxComponents } from '@/components/docs/mdx-components';
import { DocPageClient } from './doc-page-client';

export async function generateStaticParams() {
  const slugs = getAllDocSlugs();
  // Include section-level paths (e.g. ['getting-started']) so redirects are pre-rendered
  const sectionKeys = new Set(slugs.map(s => s[0]));
  const sectionSlugs = [...sectionKeys].map(key => ({ slug: [key] }));
  return [...slugs.map((slug) => ({ slug })), ...sectionSlugs];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const doc = getDocBySlug(slug);
  if (!doc) {
    // Section-level slug — redirect will fire from the page, so use section name
    if (slug.length === 1) {
      const label = slug[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return { title: `${label} - NaaP Docs` };
    }
    return { title: 'Not Found' };
  }

  return {
    title: `${doc.frontmatter.title} - NaaP Docs`,
    description: doc.frontmatter.description,
  };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const doc = getDocBySlug(slug);

  if (!doc) {
    // If the slug matches a section directory, redirect to its first page
    if (slug.length === 1) {
      const firstDoc = getFirstDocInSection(slug[0]);
      if (firstDoc) {
        redirect(`/docs/${firstDoc.slug.join('/')}`);
      }
    }
    notFound();
  }

  const navigation = getNavigation();
  const headings = extractHeadings(doc.content);
  const { prev, next } = getPrevNext(slug);
  const components = getMdxComponents();

  return (
    <div className="flex">
      {/* Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-border">
        <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto py-6 px-4">
          <DocsSidebar navigation={navigation} />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        <div className="flex">
          {/* Article */}
          <article className="flex-1 min-w-0 px-6 lg:px-10 py-10 max-w-3xl">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
              <Link href="/docs" className="hover:text-foreground transition-colors">
                Docs
              </Link>
              {slug.map((segment, i) => (
                <span key={i} className="flex items-center gap-2">
                  <span className="text-border">/</span>
                  <span className={i === slug.length - 1 ? 'text-foreground font-medium' : ''}>
                    {segment
                      .replace(/-/g, ' ')
                      .replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                </span>
              ))}
            </div>

            {/* Title */}
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
              {doc.frontmatter.title}
            </h1>
            {doc.frontmatter.description && (
              <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                {doc.frontmatter.description}
              </p>
            )}

            {/* Content — prose resets that let our custom components take over */}
            <div className="prose prose-neutral dark:prose-invert max-w-none prose-headings:scroll-mt-24 prose-headings:font-semibold prose-a:no-underline prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0 prose-pre:border-0 prose-code:before:content-none prose-code:after:content-none prose-code:font-normal prose-img:rounded-xl prose-img:border prose-img:border-border [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0 [&_pre]:!border-0 [&_pre]:!rounded-none [&_pre]:!shadow-none">
              <MDXRemote
                source={doc.content}
                components={components}
                options={{
                  mdxOptions: {
                    format: 'md',
                    remarkPlugins: [remarkGfm],
                    rehypePlugins: [rehypeSlug],
                  },
                }}
              />
            </div>

            {/* Prev / Next */}
            {(prev || next) && (
              <div className="flex items-center justify-between mt-12 pt-6 border-t border-border">
                {prev ? (
                  <Link
                    href={prev.href}
                    className="group flex flex-col items-start px-4 py-3 rounded-xl border border-border hover:border-primary/30 hover:bg-muted/50 transition-all max-w-[45%]"
                  >
                    <span className="text-xs text-muted-foreground mb-1">Previous</span>
                    <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                      {prev.title}
                    </span>
                  </Link>
                ) : (
                  <div />
                )}
                {next ? (
                  <Link
                    href={next.href}
                    className="group flex flex-col items-end px-4 py-3 rounded-xl border border-border hover:border-primary/30 hover:bg-muted/50 transition-all max-w-[45%] ml-auto"
                  >
                    <span className="text-xs text-muted-foreground mb-1">Next</span>
                    <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                      {next.title}
                    </span>
                  </Link>
                ) : (
                  <div />
                )}
              </div>
            )}
          </article>

          {/* Table of Contents */}
          <DocPageClient headings={headings} navigation={navigation} />
        </div>
      </main>
    </div>
  );
}
