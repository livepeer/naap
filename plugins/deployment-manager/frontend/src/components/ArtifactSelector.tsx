import React, { useState, useEffect } from 'react';

const API_BASE = '/api/v1/deployment-manager';

interface ArtifactInfo {
  type: string;
  displayName: string;
  description: string;
  dockerImage: string;
}

interface ArtifactVersion {
  version: string;
  publishedAt: string;
  prerelease: boolean;
  dockerImage: string;
}

interface ArtifactSelectorProps {
  selectedType: string | null;
  selectedVersion: string | null;
  onSelectType: (type: string) => void;
  onSelectVersion: (version: string, dockerImage: string) => void;
}

export const ArtifactSelector: React.FC<ArtifactSelectorProps> = ({
  selectedType,
  selectedVersion,
  onSelectType,
  onSelectVersion,
}) => {
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/artifacts`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setArtifacts(d.data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedType) { setVersions([]); return; }
    fetch(`${API_BASE}/artifacts/${selectedType}/versions`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setVersions(d.data); })
      .catch(() => {});
  }, [selectedType]);

  return (
    <div>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--dm-text-primary)' }}>Deployment Artifact</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        {artifacts.map((a) => (
          <button
            key={a.type}
            onClick={() => onSelectType(a.type)}
            style={{
              padding: '1.25rem',
              border: selectedType === a.type ? '2px solid var(--dm-accent-blue)' : '1px solid var(--dm-border)',
              borderRadius: '0.75rem',
              background: selectedType === a.type ? 'var(--dm-bg-selected)' : 'var(--dm-bg-primary)',
              color: 'var(--dm-text-primary)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--dm-text-primary)' }}>{a.displayName}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--dm-text-secondary)' }}>{a.description}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--dm-text-tertiary)', marginTop: '0.5rem', fontFamily: 'monospace' }}>
              {a.dockerImage}
            </div>
          </button>
        ))}
      </div>

      {selectedType && versions.length > 0 && (
        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--dm-text-secondary)' }}>Version</label>
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
              border: '1px solid var(--dm-border-input)',
              borderRadius: '0.375rem',
              width: '100%',
              maxWidth: '400px',
              color: 'var(--dm-text-primary)',
              backgroundColor: 'var(--dm-bg-input)',
            }}
          >
            <option value="">Select a version...</option>
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                {v.version} {v.prerelease ? '(pre-release)' : ''} — {new Date(v.publishedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};
