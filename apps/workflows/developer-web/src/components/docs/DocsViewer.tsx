import React, { useState } from 'react';
import { Copy, Check, ExternalLink, ChevronRight } from 'lucide-react';

interface DocSection {
  id: string;
  title: string;
  content: React.ReactNode;
}

interface CodeSample {
  language: string;
  label: string;
  code: string;
}

const CodeBlock: React.FC<{ samples: CodeSample[] }> = ({ samples }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(samples[activeTab].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-bg-tertiary rounded-xl overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/10">
        <div className="flex">
          {samples.map((sample, index) => (
            <button
              key={sample.language}
              onClick={() => setActiveTab(index)}
              className={`px-4 py-2 text-sm font-medium transition-all ${
                activeTab === index
                  ? 'text-accent-emerald border-b-2 border-accent-emerald'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {sample.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleCopy}
          className={`mr-2 p-2 rounded-lg transition-colors ${
            copied ? 'text-accent-emerald' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-sm font-mono text-text-primary custom-scrollbar">
        <code>{samples[activeTab].code}</code>
      </pre>
    </div>
  );
};

const docSections: DocSection[] = [
  {
    id: 'quickstart',
    title: 'Quickstart',
    content: (
      <div className="space-y-6">
        <p className="text-text-secondary">
          Get started with the Livepeer AI Gateway in under 5 minutes. This guide walks you through
          creating your first AI video generation session.
        </p>

        <div className="space-y-4">
          <h4 className="text-lg font-bold text-text-primary">1. Get your API Key</h4>
          <p className="text-text-secondary">
            Navigate to the <strong>API Keys</strong> tab and create a new key. Select your preferred
            model and gateway. Save your API key securely - it will only be shown once.
          </p>
        </div>

        <div className="space-y-4">
          <h4 className="text-lg font-bold text-text-primary">2. Make your first request</h4>
          <CodeBlock
            samples={[
              {
                language: 'curl',
                label: 'cURL',
                code: `curl -X POST https://gateway.livepeer.ai/api/v1/video/generate \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "A serene mountain landscape at sunset",
    "model": "sdxl-turbo",
    "duration": 4,
    "fps": 30
  }'`,
              },
              {
                language: 'typescript',
                label: 'TypeScript',
                code: `import { LivepeerAI } from '@livepeer/ai-sdk';

const client = new LivepeerAI({
  apiKey: 'YOUR_API_KEY',
});

const result = await client.video.generate({
  prompt: 'A serene mountain landscape at sunset',
  model: 'sdxl-turbo',
  duration: 4,
  fps: 30,
});

console.log('Video URL:', result.url);`,
              },
              {
                language: 'python',
                label: 'Python',
                code: `from livepeer_ai import LivepeerAI

client = LivepeerAI(api_key="YOUR_API_KEY")

result = client.video.generate(
    prompt="A serene mountain landscape at sunset",
    model="sdxl-turbo",
    duration=4,
    fps=30
)

print(f"Video URL: {result.url}")`,
              },
            ]}
          />
        </div>

        <div className="space-y-4">
          <h4 className="text-lg font-bold text-text-primary">3. Handle the response</h4>
          <p className="text-text-secondary">
            The API returns a video URL and metadata. For longer generations, you may receive a job ID
            to poll for completion.
          </p>
          <CodeBlock
            samples={[
              {
                language: 'json',
                label: 'Response',
                code: `{
  "id": "gen_abc123xyz",
  "status": "completed",
  "url": "https://cdn.livepeer.ai/videos/gen_abc123xyz.mp4",
  "duration": 4.0,
  "fps": 30,
  "resolution": "1024x576",
  "model": "sdxl-turbo",
  "cost": 0.32,
  "created_at": "2026-01-20T10:30:00Z"
}`,
              },
            ]}
          />
        </div>
      </div>
    ),
  },
  {
    id: 'auth',
    title: 'Authentication',
    content: (
      <div className="space-y-6">
        <p className="text-text-secondary">
          All API requests require authentication using your API key. Include it in the
          Authorization header as a Bearer token.
        </p>

        <CodeBlock
          samples={[
            {
              language: 'header',
              label: 'Header',
              code: `Authorization: Bearer lp_sk_your_api_key_here`,
            },
          ]}
        />

        <div className="p-4 bg-accent-amber/10 border border-accent-amber/20 rounded-xl">
          <h4 className="font-medium text-text-primary mb-2">Security Best Practices</h4>
          <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
            <li>Never expose your API key in client-side code</li>
            <li>Use environment variables to store keys</li>
            <li>Rotate keys periodically</li>
            <li>Revoke keys immediately if compromised</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    id: 'models',
    title: 'Models Endpoint',
    content: (
      <div className="space-y-6">
        <p className="text-text-secondary">
          List available AI models and their capabilities.
        </p>

        <div className="p-4 bg-bg-tertiary rounded-xl">
          <code className="text-accent-emerald font-mono">GET /api/v1/models</code>
        </div>

        <CodeBlock
          samples={[
            {
              language: 'curl',
              label: 'cURL',
              code: `curl https://gateway.livepeer.ai/api/v1/models \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
            },
            {
              language: 'typescript',
              label: 'TypeScript',
              code: `const models = await client.models.list();

models.forEach(model => {
  console.log(\`\${model.name}: \${model.type}\`);
});`,
            },
          ]}
        />

        <h4 className="text-lg font-bold text-text-primary">Response</h4>
        <CodeBlock
          samples={[
            {
              language: 'json',
              label: 'JSON',
              code: `{
  "models": [
    {
      "id": "sdxl-turbo",
      "name": "SDXL Turbo",
      "type": "text-to-video",
      "realtime": true,
      "cost_per_min": { "min": 0.08, "max": 0.15 },
      "latency_p50_ms": 180,
      "fps": 30
    }
  ]
}`,
            },
          ]}
        />
      </div>
    ),
  },
  {
    id: 'gateways',
    title: 'Gateways Endpoint',
    content: (
      <div className="space-y-6">
        <p className="text-text-secondary">
          List available gateways and their SLA guarantees.
        </p>

        <div className="p-4 bg-bg-tertiary rounded-xl">
          <code className="text-accent-emerald font-mono">GET /api/v1/gateways</code>
        </div>

        <CodeBlock
          samples={[
            {
              language: 'curl',
              label: 'cURL',
              code: `curl https://gateway.livepeer.ai/api/v1/gateways?model=sdxl-turbo \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
            },
          ]}
        />

        <h4 className="text-lg font-bold text-text-primary">Query Parameters</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-2 text-text-secondary font-medium">Parameter</th>
              <th className="text-left py-2 text-text-secondary font-medium">Type</th>
              <th className="text-left py-2 text-text-secondary font-medium">Description</th>
            </tr>
          </thead>
          <tbody className="text-text-primary">
            <tr className="border-b border-white/5">
              <td className="py-2 font-mono text-accent-blue">model</td>
              <td className="py-2">string</td>
              <td className="py-2 text-text-secondary">Filter by supported model</td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-2 font-mono text-accent-blue">region</td>
              <td className="py-2">string</td>
              <td className="py-2 text-text-secondary">Filter by region</td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-2 font-mono text-accent-blue">sla_tier</td>
              <td className="py-2">string</td>
              <td className="py-2 text-text-secondary">bronze, silver, or gold</td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
  },
  {
    id: 'sessions',
    title: 'Create Session',
    content: (
      <div className="space-y-6">
        <p className="text-text-secondary">
          Create a video generation session.
        </p>

        <div className="p-4 bg-bg-tertiary rounded-xl">
          <code className="text-accent-emerald font-mono">POST /api/v1/video/generate</code>
        </div>

        <h4 className="text-lg font-bold text-text-primary">Request Body</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-2 text-text-secondary font-medium">Field</th>
              <th className="text-left py-2 text-text-secondary font-medium">Type</th>
              <th className="text-left py-2 text-text-secondary font-medium">Required</th>
              <th className="text-left py-2 text-text-secondary font-medium">Description</th>
            </tr>
          </thead>
          <tbody className="text-text-primary">
            <tr className="border-b border-white/5">
              <td className="py-2 font-mono text-accent-blue">prompt</td>
              <td className="py-2">string</td>
              <td className="py-2">Yes</td>
              <td className="py-2 text-text-secondary">Text description of the video</td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-2 font-mono text-accent-blue">model</td>
              <td className="py-2">string</td>
              <td className="py-2">Yes</td>
              <td className="py-2 text-text-secondary">Model ID to use</td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-2 font-mono text-accent-blue">duration</td>
              <td className="py-2">number</td>
              <td className="py-2">No</td>
              <td className="py-2 text-text-secondary">Video length in seconds (default: 4)</td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-2 font-mono text-accent-blue">fps</td>
              <td className="py-2">number</td>
              <td className="py-2">No</td>
              <td className="py-2 text-text-secondary">Frames per second (default: 24)</td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-2 font-mono text-accent-blue">seed</td>
              <td className="py-2">number</td>
              <td className="py-2">No</td>
              <td className="py-2 text-text-secondary">Random seed for reproducibility</td>
            </tr>
          </tbody>
        </table>

        <CodeBlock
          samples={[
            {
              language: 'typescript',
              label: 'TypeScript',
              code: `const result = await client.video.generate({
  prompt: 'A futuristic cityscape with flying cars',
  model: 'sdxl-turbo',
  duration: 6,
  fps: 30,
  seed: 42,
});`,
            },
            {
              language: 'python',
              label: 'Python',
              code: `result = client.video.generate(
    prompt="A futuristic cityscape with flying cars",
    model="sdxl-turbo",
    duration=6,
    fps=30,
    seed=42
)`,
            },
          ]}
        />
      </div>
    ),
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    content: (
      <div className="space-y-6">
        <p className="text-text-secondary">
          Receive real-time notifications when your video generations complete.
        </p>

        <div className="p-4 bg-accent-blue/10 border border-accent-blue/20 rounded-xl">
          <h4 className="font-medium text-text-primary mb-2">Coming Soon</h4>
          <p className="text-sm text-text-secondary">
            Webhook support is currently in development. For now, poll the status endpoint for
            long-running generations.
          </p>
        </div>

        <h4 className="text-lg font-bold text-text-primary">Planned Webhook Events</h4>
        <ul className="list-disc list-inside text-text-secondary space-y-2">
          <li><code className="text-accent-blue">video.generation.started</code> - Generation has begun</li>
          <li><code className="text-accent-blue">video.generation.completed</code> - Generation finished successfully</li>
          <li><code className="text-accent-blue">video.generation.failed</code> - Generation encountered an error</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'sdks',
    title: 'SDKs',
    content: (
      <div className="space-y-6">
        <p className="text-text-secondary">
          Official SDKs for popular languages.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a
            href="#"
            className="flex items-center gap-4 p-4 bg-bg-tertiary rounded-xl hover:bg-bg-tertiary/80 transition-colors group"
          >
            <div className="w-12 h-12 rounded-xl bg-accent-blue/10 flex items-center justify-center text-xl font-bold text-accent-blue">
              TS
            </div>
            <div className="flex-1">
              <p className="font-medium text-text-primary group-hover:text-accent-emerald transition-colors">
                @livepeer/ai-sdk
              </p>
              <p className="text-xs text-text-secondary">TypeScript / JavaScript</p>
            </div>
            <ExternalLink size={16} className="text-text-secondary" />
          </a>

          <a
            href="#"
            className="flex items-center gap-4 p-4 bg-bg-tertiary rounded-xl hover:bg-bg-tertiary/80 transition-colors group"
          >
            <div className="w-12 h-12 rounded-xl bg-accent-amber/10 flex items-center justify-center text-xl font-bold text-accent-amber">
              Py
            </div>
            <div className="flex-1">
              <p className="font-medium text-text-primary group-hover:text-accent-emerald transition-colors">
                livepeer-ai
              </p>
              <p className="text-xs text-text-secondary">Python 3.8+</p>
            </div>
            <ExternalLink size={16} className="text-text-secondary" />
          </a>
        </div>

        <h4 className="text-lg font-bold text-text-primary">Installation</h4>
        <CodeBlock
          samples={[
            {
              language: 'bash',
              label: 'npm',
              code: `npm install @livepeer/ai-sdk`,
            },
            {
              language: 'bash',
              label: 'pip',
              code: `pip install livepeer-ai`,
            },
          ]}
        />
      </div>
    ),
  },
];

export const DocsViewer: React.FC = () => {
  const [activeSection, setActiveSection] = useState('quickstart');

  const currentSection = docSections.find((s) => s.id === activeSection);

  return (
    <div className="flex gap-6 min-h-[600px]">
      {/* Sidebar */}
      <nav className="w-56 shrink-0">
        <div className="sticky top-0 space-y-1">
          {docSections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                activeSection === section.id
                  ? 'bg-accent-emerald/10 text-accent-emerald'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
              }`}
            >
              <ChevronRight
                size={14}
                className={`transition-transform ${
                  activeSection === section.id ? 'rotate-90' : ''
                }`}
              />
              {section.title}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <div className="flex-1 glass-card p-8 overflow-y-auto custom-scrollbar">
        <h2 className="text-2xl font-bold text-text-primary mb-6">{currentSection?.title}</h2>
        {currentSection?.content}
      </div>
    </div>
  );
};
