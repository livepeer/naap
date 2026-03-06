import React from 'react';

interface EnvVarsEditorProps {
  envVars: Record<string, string>;
  onChange: (envVars: Record<string, string>) => void;
}

export const EnvVarsEditor: React.FC<EnvVarsEditorProps> = ({ envVars, onChange }) => {
  const entries = Object.entries(envVars);

  const updateKey = (oldKey: string, newKey: string) => {
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(envVars)) {
      updated[k === oldKey ? newKey : k] = v;
    }
    onChange(updated);
  };

  const updateValue = (key: string, value: string) => {
    onChange({ ...envVars, [key]: value });
  };

  const addEntry = () => {
    const key = `VAR_${entries.length + 1}`;
    onChange({ ...envVars, [key]: '' });
  };

  const removeEntry = (key: string) => {
    const updated = { ...envVars };
    delete updated[key];
    onChange(updated);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--dm-text-primary)' }}>Environment Variables</label>
        <button
          onClick={addEntry}
          style={{
            padding: '0.25rem 0.75rem', fontSize: '0.75rem', background: 'var(--dm-accent-blue)',
            color: '#fff', border: 'none', borderRadius: '0.25rem', cursor: 'pointer',
          }}
        >
          + Add Variable
        </button>
      </div>
      {entries.length === 0 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--dm-text-tertiary)' }}>No environment variables configured.</p>
      )}
      {entries.map(([key, value], idx) => (
        <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
          <input
            type="text"
            value={key}
            onChange={(e) => updateKey(key, e.target.value)}
            placeholder="KEY"
            style={{
              flex: 1, padding: '0.375rem 0.5rem', border: '1px solid var(--dm-border-input)',
              borderRadius: '0.25rem', fontSize: '0.8rem', fontFamily: 'monospace',
              color: 'var(--dm-text-primary)', backgroundColor: 'var(--dm-bg-input)',
            }}
          />
          <input
            type="text"
            value={value}
            onChange={(e) => updateValue(key, e.target.value)}
            placeholder="value"
            style={{
              flex: 2, padding: '0.375rem 0.5rem', border: '1px solid var(--dm-border-input)',
              borderRadius: '0.25rem', fontSize: '0.8rem', fontFamily: 'monospace',
              color: 'var(--dm-text-primary)', backgroundColor: 'var(--dm-bg-input)',
            }}
          />
          <button
            onClick={() => removeEntry(key)}
            style={{
              padding: '0.25rem 0.5rem', background: '#fef2f2', color: '#dc2626',
              border: '1px solid #fecaca', borderRadius: '0.25rem', cursor: 'pointer', fontSize: '0.8rem',
            }}
          >
            X
          </button>
        </div>
      ))}
    </div>
  );
};
