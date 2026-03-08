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
  return (
    <div>
      <h3 className="text-sm font-medium mb-3 text-foreground">SSH Host Configuration</h3>
      <div className="grid grid-cols-[2fr_1fr] gap-4 mb-4">
        <div>
          <label className="text-xs font-medium block mb-1.5 text-muted-foreground">Host</label>
          <input
            type="text"
            value={host}
            onChange={(e) => onChange('sshHost', e.target.value)}
            placeholder="10.0.1.5 or gpu-server.example.com"
            className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1.5 text-muted-foreground">Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => onChange('sshPort', parseInt(e.target.value, 10))}
            className="w-full h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
          />
        </div>
      </div>
      <div className="mb-4">
        <label className="text-xs font-medium block mb-1.5 text-muted-foreground">Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => onChange('sshUsername', e.target.value)}
          placeholder="deploy"
          className="w-full max-w-xs h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
        />
      </div>
      {onTestConnection && (
        <div className="flex items-center gap-3">
          <button
            onClick={onTestConnection}
            className="h-9 px-4 bg-foreground text-background border-none rounded-md cursor-pointer text-sm font-medium"
          >
            Test Connection
          </button>
          {testResult && (
            <span className={`text-sm ${testResult.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
              {testResult.message}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
