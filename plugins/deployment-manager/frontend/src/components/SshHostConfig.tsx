import React from 'react';

interface SshHostConfigProps {
  host: string;
  port: number;
  username: string;
  onChange: (field: string, value: string | number) => void;
  onTestConnection?: () => void;
  testResult?: { success: boolean; message: string } | null;
}

export const SshHostConfig: React.FC<SshHostConfigProps> = ({
  host,
  port,
  username,
  onChange,
  onTestConnection,
  testResult,
}) => {
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '0.375rem',
    fontSize: '0.875rem',
  };

  return (
    <div>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>SSH Host Configuration</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <label style={{ fontSize: '0.8rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Host</label>
          <input
            type="text"
            value={host}
            onChange={(e) => onChange('sshHost', e.target.value)}
            placeholder="10.0.1.5 or gpu-server.example.com"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.8rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => onChange('sshPort', parseInt(e.target.value, 10))}
            style={inputStyle}
          />
        </div>
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ fontSize: '0.8rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => onChange('sshUsername', e.target.value)}
          placeholder="deploy"
          style={{ ...inputStyle, maxWidth: '300px' }}
        />
      </div>
      {onTestConnection && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={onTestConnection}
            style={{
              padding: '0.5rem 1rem',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Test Connection
          </button>
          {testResult && (
            <span style={{ fontSize: '0.8rem', color: testResult.success ? '#16a34a' : '#dc2626' }}>
              {testResult.message}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
