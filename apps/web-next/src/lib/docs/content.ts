import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocFrontmatter {
  title: string;
  description: string;
  order?: number;
  section?: string;
  icon?: string;
}

export interface DocPage {
  slug: string[];
  frontmatter: DocFrontmatter;
  content: string;
}

export interface NavItem {
  title: string;
  href: string;
  order: number;
  icon?: string;
  children?: NavItem[];
}

export interface NavSection {
  title: string;
  order: number;
  icon?: string;
  items: NavItem[];
}

export interface SearchEntry {
  title: string;
  description: string;
  href: string;
  section: string;
}

export interface TocHeading {
  id: string;
  text: string;
  level: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTENT_DIR = path.join(process.cwd(), 'src/content/docs');

const SECTION_META: Record<string, { title: string; order: number; icon: string }> = {
  'getting-started': { title: 'Getting Started', order: 1, icon: 'Rocket' },
  concepts: { title: 'Core Concepts', order: 2, icon: 'BookOpen' },
  guides: { title: 'Guides', order: 3, icon: 'Map' },
  'api-reference': { title: 'API Reference', order: 4, icon: 'Code' },
  examples: { title: 'Examples', order: 5, icon: 'FileCode' },
  prompts: { title: 'AI Prompt Templates', order: 6, icon: 'Sparkles' },
  community: { title: 'Community', order: 7, icon: 'Users' },
};

// ---------------------------------------------------------------------------
// Frontmatter parser (simple, no extra deps)
// ---------------------------------------------------------------------------

function parseFrontmatter(raw: string): { frontmatter: DocFrontmatter; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {
      frontmatter: { title: 'Untitled', description: '' },
      content: raw,
    };
  }

  const yamlBlock = match[1];
  const content = raw.slice(match[0].length).trim();
  const frontmatter: Record<string, unknown> = {};

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: string | number = line.slice(colonIdx + 1).trim();
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Parse numbers
    if (/^\d+$/.test(value)) {
      value = parseInt(value, 10);
    }
    frontmatter[key] = value;
  }

  return {
    frontmatter: {
      title: (frontmatter.title as string) || 'Untitled',
      description: (frontmatter.description as string) || '',
      order: frontmatter.order as number | undefined,
      section: frontmatter.section as string | undefined,
      icon: frontmatter.icon as string | undefined,
    },
    content,
  };
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

function getMdxFiles(dir: string, basePath: string[] = []): { slug: string[]; filePath: string }[] {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: { slug: string[]; filePath: string }[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      results.push(...getMdxFiles(path.join(dir, entry.name), [...basePath, entry.name]));
    } else if (entry.name.endsWith('.mdx')) {
      const name = entry.name.replace(/\.mdx$/, '');
      results.push({
        slug: [...basePath, name],
        filePath: path.join(dir, entry.name),
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get a single doc page by its slug segments */
export function getDocBySlug(slug: string[]): DocPage | null {
  const filePath = path.join(CONTENT_DIR, ...slug) + '.mdx';

  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { frontmatter, content } = parseFrontmatter(raw);

  return { slug, frontmatter, content };
}

/** Get all doc pages */
export function getAllDocs(): DocPage[] {
  const files = getMdxFiles(CONTENT_DIR);

  return files.map(({ slug, filePath }) => {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, content } = parseFrontmatter(raw);
    return { slug, frontmatter, content };
  });
}

/** Get all slug params for generateStaticParams */
export function getAllDocSlugs(): string[][] {
  const files = getMdxFiles(CONTENT_DIR);
  return files.map(f => f.slug);
}

/** Build navigation tree grouped by section */
export function getNavigation(): NavSection[] {
  const docs = getAllDocs();
  const sectionMap = new Map<string, NavItem[]>();

  for (const doc of docs) {
    const sectionKey = doc.slug[0];
    if (!sectionMap.has(sectionKey)) {
      sectionMap.set(sectionKey, []);
    }

    sectionMap.get(sectionKey)!.push({
      title: doc.frontmatter.title,
      href: `/docs/${doc.slug.join('/')}`,
      order: doc.frontmatter.order ?? 99,
      icon: doc.frontmatter.icon,
    });
  }

  const sections: NavSection[] = [];

  for (const [key, items] of sectionMap) {
    const meta = SECTION_META[key] || { title: key, order: 99, icon: 'File' };
    sections.push({
      title: meta.title,
      order: meta.order,
      icon: meta.icon,
      items: items.sort((a, b) => a.order - b.order),
    });
  }

  return sections.sort((a, b) => a.order - b.order);
}

/** Build flat search index */
export function getSearchIndex(): SearchEntry[] {
  const docs = getAllDocs();

  return docs.map(doc => {
    const sectionKey = doc.slug[0];
    const meta = SECTION_META[sectionKey];
    return {
      title: doc.frontmatter.title,
      description: doc.frontmatter.description,
      href: `/docs/${doc.slug.join('/')}`,
      section: meta?.title || sectionKey,
    };
  });
}

/** Extract headings from MDX content for table of contents */
export function extractHeadings(content: string): TocHeading[] {
  const headingRegex = /^(#{2,4})\s+(.+)$/gm;
  const headings: TocHeading[] = [];
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    headings.push({ id, text, level });
  }

  return headings;
}

/** Get prev/next pages relative to current slug */
export function getPrevNext(currentSlug: string[]): { prev: NavItem | null; next: NavItem | null } {
  const nav = getNavigation();
  const allItems: NavItem[] = [];

  for (const section of nav) {
    for (const item of section.items) {
      allItems.push(item);
    }
  }

  const currentHref = `/docs/${currentSlug.join('/')}`;
  const currentIndex = allItems.findIndex(item => item.href === currentHref);

  return {
    prev: currentIndex > 0 ? allItems[currentIndex - 1] : null,
    next: currentIndex < allItems.length - 1 ? allItems[currentIndex + 1] : null,
  };
}
