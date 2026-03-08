import React from 'react';
import { X } from 'lucide-react';

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
      <div className="flex justify-between items-center mb-3">
        <label className="text-xs font-medium text-foreground">Environment Variables</label>
        <button
          onClick={addEntry}
          className="h-7 px-3 text-xs bg-secondary text-foreground border border-border rounded-md cursor-pointer font-medium hover:bg-muted transition-colors"
        >
          + Add Variable
        </button>
      </div>
      {entries.length === 0 && (
        <p className="text-xs text-muted-foreground">No environment variables configured.</p>
      )}
      {entries.map(([key, value], idx) => (
        <div key={idx} className="flex gap-2 mb-2 items-center">
          <input
            type="text"
            value={key}
            onChange={(e) => updateKey(key, e.target.value)}
            placeholder="KEY"
            className="flex-1 h-8 px-2.5 border border-border rounded-md text-xs font-mono text-foreground bg-background"
          />
          <input
            type="text"
            value={value}
            onChange={(e) => updateValue(key, e.target.value)}
            placeholder="value"
            className="flex-[2] h-8 px-2.5 border border-border rounded-md text-xs font-mono text-foreground bg-background"
          />
          <button
            onClick={() => removeEntry(key)}
            className="h-8 w-8 flex items-center justify-center bg-red-50 dark:bg-red-950/30 text-red-500 border border-red-200 dark:border-red-800 rounded-md cursor-pointer shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
};
