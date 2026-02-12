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
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Deployment Artifact</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        {artifacts.map((a) => (
          <button
            key={a.type}
            onClick={() => onSelectType(a.type)}
            style={{
              padding: '1.25rem',
              border: selectedType === a.type ? '2px solid #3b82f6' : '1px solid #e5e7eb',
              borderRadius: '0.75rem',
              background: selectedType === a.type ? '#eff6ff' : '#fff',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{a.displayName}</div>
            <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{a.description}</div>
            <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.5rem', fontFamily: 'monospace' }}>
              {a.dockerImage}
            </div>
          </button>
        ))}
      </div>

      {selectedType && versions.length > 0 && (
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
                {v.version} {v.prerelease ? '(pre-release)' : ''} — {new Date(v.publishedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};
