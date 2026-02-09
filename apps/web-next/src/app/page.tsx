import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-gradient-to-b from-background to-muted">
      <div className="z-10 max-w-5xl w-full items-center justify-center text-center">
        <h1 className="text-6xl font-bold tracking-tight mb-6">
          NaaP Platform
        </h1>
        <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
          Network as a Platform - Decentralized Infrastructure Management for the Next Generation
        </p>

        <div className="flex gap-4 justify-center mb-12">
          <Link
            href="/login"
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            Get Started
          </Link>
          <Link
            href="/docs"
            className="px-6 py-3 border border-border rounded-lg font-medium hover:bg-muted transition-colors"
          >
            Documentation
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <FeatureCard
            title="Gateway Management"
            description="Monitor and manage your AI gateways with real-time analytics and automated scaling."
          />
          <FeatureCard
            title="Plugin Ecosystem"
            description="Extend functionality with a rich ecosystem of plugins for video, AI, and more."
          />
          <FeatureCard
            title="Vercel-Ready"
            description="Deploy globally with edge functions, serverless APIs, and zero configuration."
          />
        </div>
      </div>
    </main>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-6 border border-border rounded-xl bg-card hover:border-primary/50 transition-colors">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}
