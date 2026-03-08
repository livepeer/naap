import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';

interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  dockerImage: string;
  defaultVersion?: string;
  healthEndpoint: string;
  healthPort: number;
  defaultGpuModel?: string;
  defaultGpuVramGb?: number;
  category: 'curated' | 'custom';
}

interface TemplateVersion {
  version: string;
  publishedAt: string;
  prerelease: boolean;
  dockerImage: string;
}

interface TemplateSelectorProps {
  selectedTemplateId: string | null;
  selectedVersion: string | null;
  customImage: string;
  customHealthPort: number;
  customHealthEndpoint: string;
  onSelectTemplate: (template: Template) => void;
  onSelectVersion: (version: string, dockerImage: string) => void;
  onCustomImageChange: (image: string) => void;
  onCustomHealthPortChange: (port: number) => void;
  onCustomHealthEndpointChange: (endpoint: string) => void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  selectedTemplateId,
  selectedVersion,
  customImage,
  customHealthPort,
  customHealthEndpoint,
  onSelectTemplate,
  onSelectVersion,
  onCustomImageChange,
  onCustomHealthPortChange,
  onCustomHealthEndpointChange,
}) => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [isCustom, setIsCustom] = useState(false);

  useEffect(() => {
    apiFetch('/templates')
      .then((r) => r.json())
      .then((d) => { if (d.success) setTemplates(d.data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedTemplateId || isCustom) { setVersions([]); return; }
    apiFetch(`/templates/${selectedTemplateId}/versions`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setVersions(d.data); })
      .catch(() => {});
  }, [selectedTemplateId, isCustom]);

  const handleSelectCustom = () => {
    setIsCustom(true);
    onSelectTemplate({
      id: 'custom',
      name: 'Custom Docker Image',
      description: 'Deploy any Docker image',
      icon: '\ud83d\udce6',
      dockerImage: '',
      healthEndpoint: '/health',
      healthPort: 8080,
      category: 'custom',
    });
  };

  return (
    <div>
      <h3 className="text-base font-semibold mb-1 text-foreground">Choose a Template</h3>
      <p className="text-muted-foreground text-sm mb-5">
        Pick a curated template or deploy any Docker image.
      </p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 mb-5">
        {templates.map((t) => {
          const isSelected = selectedTemplateId === t.id && !isCustom;
          return (
            <button
              key={t.id}
              onClick={() => { setIsCustom(false); onSelectTemplate(t); }}
              className={`p-4 rounded-lg cursor-pointer text-left transition-all text-foreground ${
                isSelected
                  ? 'border-2 border-foreground bg-secondary'
                  : 'border border-border bg-card hover:border-muted-foreground/30'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{t.icon}</span>
                <div>
                  <div className="font-medium text-sm text-foreground">{t.name}</div>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    t.category === 'curated'
                      ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'
                      : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                  }`}>
                    {t.category}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-2 mt-0">{t.description}</p>
              <div className="text-xs text-muted-foreground font-mono truncate">
                {t.dockerImage}
              </div>
            </button>
          );
        })}

        <button
          onClick={handleSelectCustom}
          className={`p-4 rounded-lg cursor-pointer text-left transition-all text-foreground ${
            isCustom
              ? 'border-2 border-foreground bg-secondary'
              : 'border border-dashed border-border bg-card hover:border-muted-foreground/30'
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            <Plus size={24} className="text-muted-foreground" />
            <div>
              <div className="font-medium text-sm text-foreground">Custom Docker Image</div>
              <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                any image
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground m-0">
            Deploy any Docker image with GPU support.
          </p>
        </button>
      </div>

      {/* Custom image fields */}
      {isCustom && (
        <div className="p-4 bg-secondary rounded-lg mb-5">
          <div className="mb-4">
            <label className="text-xs font-medium block mb-1.5 text-muted-foreground">
              Docker Image *
            </label>
            <input
              type="text"
              value={customImage}
              onChange={(e) => onCustomImageChange(e.target.value)}
              placeholder="myregistry/my-model:latest"
              className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium block mb-1.5 text-muted-foreground">
                Health Port
              </label>
              <input
                type="number"
                value={customHealthPort}
                onChange={(e) => onCustomHealthPortChange(parseInt(e.target.value, 10) || 8080)}
                className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5 text-muted-foreground">
                Health Endpoint
              </label>
              <input
                type="text"
                value={customHealthEndpoint}
                onChange={(e) => onCustomHealthEndpointChange(e.target.value)}
                placeholder="/health"
                className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
              />
            </div>
          </div>
        </div>
      )}

      {/* Version picker for curated templates */}
      {selectedTemplateId && !isCustom && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Version</label>
          {versions.length > 0 ? (
            <select
              value={selectedVersion || ''}
              onChange={(e) => {
                const v = versions.find((ver) => ver.version === e.target.value);
                if (v) onSelectVersion(v.version, v.dockerImage);
              }}
              className="block mt-1.5 h-9 px-3 border border-border rounded-md w-full max-w-md text-sm text-foreground bg-background"
            >
              <option value="">Select a version...</option>
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version} {v.prerelease ? '(pre-release)' : ''} {v.publishedAt ? `\u2014 ${new Date(v.publishedAt).toLocaleDateString()}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-muted-foreground mt-1.5">
              Using latest version. Click <strong>Next</strong> to continue.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
