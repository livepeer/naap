import Link from 'next/link';
import {
  Rocket,
  BookOpen,
  Map,
  Code,
  FileCode,
  Users,
  ArrowRight,
  Zap,
  Sparkles,
} from 'lucide-react';
import { QuickCommand } from '@/components/docs/quick-command';

export const metadata = {
  title: 'NaaP Documentation',
  description: 'Developer documentation for the NaaP (Network as a Platform) ecosystem.',
};

const sections = [
  {
    title: 'Quick Start',
    description: 'Get your first plugin running in under 5 minutes.',
    href: '/docs/getting-started/quickstart',
    icon: Rocket,
    color: 'from-emerald-500/20 to-emerald-500/5',
    borderColor: 'border-emerald-500/20 hover:border-emerald-500/40',
    iconColor: 'text-emerald-500',
  },
  {
    title: 'Core Concepts',
    description: 'Understand the architecture, plugin system, and shell services.',
    href: '/docs/concepts/what-is-naap',
    icon: BookOpen,
    color: 'from-blue-500/20 to-blue-500/5',
    borderColor: 'border-blue-500/20 hover:border-blue-500/40',
    iconColor: 'text-blue-500',
  },
  {
    title: 'Step-by-Step Guides',
    description: 'Build, test, and publish plugins with detailed walkthroughs.',
    href: '/docs/guides/your-first-plugin',
    icon: Map,
    color: 'from-purple-500/20 to-purple-500/5',
    borderColor: 'border-purple-500/20 hover:border-purple-500/40',
    iconColor: 'text-purple-500',
  },
  {
    title: 'API Reference',
    description: 'Complete SDK hooks, types, and interface documentation.',
    href: '/docs/api-reference/sdk-hooks',
    icon: Code,
    color: 'from-amber-500/20 to-amber-500/5',
    borderColor: 'border-amber-500/20 hover:border-amber-500/40',
    iconColor: 'text-amber-500',
  },
  {
    title: 'Examples & Snippets',
    description: 'Copy-paste code snippets to get started quickly on any topic.',
    href: '/docs/examples/snippets',
    icon: FileCode,
    color: 'from-rose-500/20 to-rose-500/5',
    borderColor: 'border-rose-500/20 hover:border-rose-500/40',
    iconColor: 'text-rose-500',
  },
  {
    title: 'AI Prompt Templates',
    description: 'Build plugins without coding — use AI prompts to generate production-ready code.',
    href: '/docs/prompts/how-to-use',
    icon: Sparkles,
    color: 'from-violet-500/20 to-violet-500/5',
    borderColor: 'border-violet-500/20 hover:border-violet-500/40',
    iconColor: 'text-violet-500',
  },
  {
    title: 'Community',
    description: 'Contribute to NaaP and publish your own plugin documentation.',
    href: '/docs/community/contributing',
    icon: Users,
    color: 'from-cyan-500/20 to-cyan-500/5',
    borderColor: 'border-cyan-500/20 hover:border-cyan-500/40',
    iconColor: 'text-cyan-500',
  },
];

const quickLinks = [
  {
    title: 'Install the CLI',
    code: 'npm install -g @naap/plugin-sdk',
    icon: 'terminal' as const,
  },
  {
    title: 'Create a Plugin',
    code: 'naap-plugin create my-plugin',
    icon: 'puzzle' as const,
  },
  {
    title: 'Start Dev Server',
    code: 'naap-plugin dev',
    icon: 'zap' as const,
  },
];

export default function DocsHomePage() {
  return (
    <div className="px-4 lg:px-8">
      {/* Hero */}
      <div className="max-w-4xl mx-auto pt-16 pb-12 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
          <Zap size={14} />
          Developer Documentation
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
          Build on{' '}
          <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            NaaP
          </span>
        </h1>
        <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
          Everything you need to build, test, and publish plugins for the Network as a Platform
          ecosystem. From quick starts to API references.
        </p>

        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            href="/docs/getting-started/quickstart"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            Get Started
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/docs/prompts/how-to-use"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 transition-colors"
          >
            <Sparkles size={16} />
            Build with AI
          </Link>
          <Link
            href="/docs/api-reference/sdk-hooks"
            className="inline-flex items-center gap-2 px-5 py-2.5 border border-border rounded-lg font-medium text-foreground hover:bg-muted transition-colors"
          >
            API Reference
          </Link>
        </div>
      </div>

      {/* Quick Install */}
      <div className="max-w-4xl mx-auto mb-16">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {quickLinks.map((link) => (
            <QuickCommand
              key={link.title}
              label={link.title}
              command={link.code}
              icon={link.icon}
            />
          ))}
        </div>
      </div>

      {/* AI Prompt Templates callout */}
      <div className="max-w-4xl mx-auto mb-16">
        <Link
          href="/docs/prompts/how-to-use"
          className="group block relative p-6 rounded-2xl border border-violet-500/20 bg-gradient-to-r from-violet-500/10 via-purple-500/5 to-fuchsia-500/10 hover:border-violet-500/40 transition-all hover:shadow-lg"
        >
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
              <Sparkles size={24} className="text-violet-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-lg font-semibold text-foreground">New: AI Prompt Templates</h3>
                <span className="px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-500 text-xs font-medium">
                  No coding required
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                Build production-quality NaaP plugins by copying prompt templates into your favorite AI assistant
                (Cursor, ChatGPT, Claude, Copilot). Prompts cover frontend plugins, full-stack apps, UI design,
                testing, and publishing.
              </p>
              <span className="inline-flex items-center gap-1 text-sm font-medium text-violet-500 group-hover:gap-2 transition-all">
                Browse 8 prompt templates
                <ArrowRight size={14} />
              </span>
            </div>
          </div>
        </Link>
      </div>

      {/* Section Cards */}
      <div className="max-w-5xl mx-auto pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <Link
                key={section.title}
                href={section.href}
                className={`group relative p-6 rounded-xl border ${section.borderColor} bg-gradient-to-b ${section.color} transition-all hover:shadow-lg hover:-translate-y-0.5`}
              >
                <div className="w-10 h-10 rounded-lg bg-background border border-border flex items-center justify-center mb-4">
                  <Icon size={20} className={section.iconColor} />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-foreground">{section.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {section.description}
                </p>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-2 transition-all">
                  Explore
                  <ArrowRight size={14} />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
