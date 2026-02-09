import Link from 'next/link';
import { FileQuestion, ArrowLeft } from 'lucide-react';

export default function DocsNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <FileQuestion size={48} className="text-muted-foreground mb-4" />
      <h2 className="text-2xl font-bold mb-2">Page Not Found</h2>
      <p className="text-muted-foreground mb-6 max-w-md">
        The documentation page you&apos;re looking for doesn&apos;t exist. It may have been moved or
        removed.
      </p>
      <div className="flex gap-3">
        <Link
          href="/docs"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          <ArrowLeft size={16} />
          Back to Docs
        </Link>
        <Link
          href="/docs/getting-started/quickstart"
          className="inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg font-medium hover:bg-muted transition-colors"
        >
          Quick Start
        </Link>
      </div>
    </div>
  );
}
