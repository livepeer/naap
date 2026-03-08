import React, { useState, useEffect } from 'react';
import { apiFetch } from '../lib/apiFetch';

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
    apiFetch('/artifacts')
      .then((r) => r.json())
      .then((d) => { if (d.success) setArtifacts(d.data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedType) { setVersions([]); return; }
    apiFetch(`/artifacts/${selectedType}/versions`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setVersions(d.data); })
      .catch(() => {});
  }, [selectedType]);

  return (
    <div>
      <h3 className="text-sm font-medium mb-3 text-foreground">Deployment Artifact</h3>
      <div className="grid grid-cols-2 gap-3 mb-5">
        {artifacts.map((a) => (
          <button
            key={a.type}
            onClick={() => onSelectType(a.type)}
            className={`p-4 rounded-lg cursor-pointer text-left transition-all ${
              selectedType === a.type
                ? 'border-2 border-foreground bg-secondary'
                : 'border border-border bg-card hover:border-muted-foreground/30'
            }`}
          >
            <div className="font-medium text-sm text-foreground mb-1">{a.displayName}</div>
            <div className="text-xs text-muted-foreground">{a.description}</div>
            <div className="text-xs text-muted-foreground mt-1.5 font-mono truncate">
              {a.dockerImage}
            </div>
          </button>
        ))}
      </div>

      {selectedType && versions.length > 0 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Version</label>
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
                {v.version} {v.prerelease ? '(pre-release)' : ''} — {new Date(v.publishedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};
