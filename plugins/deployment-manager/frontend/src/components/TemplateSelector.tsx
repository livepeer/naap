import React, { useState, useEffect } from 'react';
import { Package, Plus } from 'lucide-react';

const API_BASE = '/api/v1/deployment-manager';

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
    fetch(`${API_BASE}/templates`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setTemplates(d.data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedTemplateId || isCustom) { setVersions([]); return; }
    fetch(`${API_BASE}/templates/${selectedTemplateId}/versions`)
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
      icon: '📦',
      dockerImage: '',
      healthEndpoint: '/health',
      healthPort: 8080,
      category: 'custom',
    });
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '0.375rem',
    fontSize: '0.875rem',
  };

  return (
    <div>
      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>Choose a Template</h3>
      <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        Pick a curated template or deploy any Docker image.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => { setIsCustom(false); onSelectTemplate(t); }}
            style={{
              padding: '1.25rem',
              border: selectedTemplateId === t.id && !isCustom ? '2px solid #3b82f6' : '1px solid #e5e7eb',
              borderRadius: '0.75rem',
              background: selectedTemplateId === t.id && !isCustom ? '#eff6ff' : '#fff',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1.75rem' }}>{t.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '1rem' }}>{t.name}</div>
                <span style={{
                  fontSize: '0.65rem',
                  padding: '0.1rem 0.4rem',
                  borderRadius: '1rem',
                  background: t.category === 'curated' ? '#dbeafe' : '#fef3c7',
                  color: t.category === 'curated' ? '#1d4ed8' : '#92400e',
                }}>
                  {t.category}
                </span>
              </div>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '0 0 0.5rem 0' }}>{t.description}</p>
            <div style={{ fontSize: '0.7rem', color: '#9ca3af', fontFamily: 'monospace' }}>
              {t.dockerImage}
            </div>
          </button>
        ))}

        <button
          onClick={handleSelectCustom}
          style={{
            padding: '1.25rem',
            border: isCustom ? '2px solid #3b82f6' : '1px dashed #d1d5db',
            borderRadius: '0.75rem',
            background: isCustom ? '#eff6ff' : '#fafafa',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <Plus size={28} style={{ color: '#6b7280' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: '1rem' }}>Custom Docker Image</div>
              <span style={{
                fontSize: '0.65rem',
                padding: '0.1rem 0.4rem',
                borderRadius: '1rem',
                background: '#f3f4f6',
                color: '#374151',
              }}>
                any image
              </span>
            </div>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>
            Deploy any Docker image with GPU support.
          </p>
        </button>
      </div>

      {/* Custom image fields */}
      {isCustom && (
        <div style={{ padding: '1rem', background: '#f9fafb', borderRadius: '0.5rem', marginBottom: '1.5rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>
              Docker Image *
            </label>
            <input
              type="text"
              value={customImage}
              onChange={(e) => onCustomImageChange(e.target.value)}
              placeholder="myregistry/my-model:latest"
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>
                Health Port
              </label>
              <input
                type="number"
                value={customHealthPort}
                onChange={(e) => onCustomHealthPortChange(parseInt(e.target.value, 10) || 8080)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>
                Health Endpoint
              </label>
              <input
                type="text"
                value={customHealthEndpoint}
                onChange={(e) => onCustomHealthEndpointChange(e.target.value)}
                placeholder="/health"
                style={inputStyle}
              />
            </div>
          </div>
        </div>
      )}

      {/* Version picker for curated templates */}
      {selectedTemplateId && !isCustom && versions.length > 0 && (
        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Version</label>
          <select
            value={selectedVersion || ''}
            onChange={(e) => {
              const v = versions.find((ver) => ver.version === e.target.value);
              if (v) onSelectVersion(v.version, v.dockerImage);
            }}
            style={{
              display: 'block',
              marginTop: '0.5rem',
              padding: '0.5rem 1rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              width: '100%',
              maxWidth: '400px',
            }}
          >
            <option value="">Select a version...</option>
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                {v.version} {v.prerelease ? '(pre-release)' : ''} {v.publishedAt ? `— ${new Date(v.publishedAt).toLocaleDateString()}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};
