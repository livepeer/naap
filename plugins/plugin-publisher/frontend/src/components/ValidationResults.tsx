import React from 'react';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import type { ValidationResult, ValidationError } from '../lib/api';

interface ValidationResultsProps {
  result: ValidationResult | null;
  loading?: boolean;
}

/**
 * Get fix suggestion based on error type
 */
function getFixSuggestion(error: ValidationError): string | null {
  const path = error.path?.toLowerCase() || '';
  const message = error.message?.toLowerCase() || '';

  // Name errors
  if (path.includes('name') || message.includes('name')) {
    if (message.includes('required')) {
      return 'Add a "name" field to your plugin.json (e.g., "my-plugin")';
    }
    if (message.includes('kebab') || message.includes('lowercase')) {
      return 'Use kebab-case for the name (lowercase with hyphens): "my-plugin-name"';
    }
    if (message.includes('alpha')) {
      return 'Name must start with a letter and contain only lowercase letters, numbers, and hyphens';
    }
  }

  // Version errors
  if (path.includes('version') || message.includes('version')) {
    if (message.includes('required')) {
      return 'Add a "version" field using semantic versioning (e.g., "1.0.0")';
    }
    if (message.includes('semver') || message.includes('invalid')) {
      return 'Use semantic versioning format: MAJOR.MINOR.PATCH (e.g., "1.2.3")';
    }
  }

  // Frontend errors
  if (path.includes('frontend')) {
    if (message.includes('entry')) {
      return 'Specify the frontend entry point in plugin.json: { "frontend": { "entry": "./frontend/dist/production/<plugin-name>.js" } }';
    }
    if (message.includes('routes')) {
      return 'Add at least one route: { "frontend": { "routes": ["/my-plugin"] } }';
    }
  }

  // Backend errors
  if (path.includes('backend')) {
    if (message.includes('port')) {
      return 'Specify the backend port: { "backend": { "port": 4100 } }';
    }
    if (message.includes('entry')) {
      return 'Specify the backend entry point: { "backend": { "entry": "./backend/src/server.ts" } }';
    }
  }

  // UMD/CDN build errors
  if (message.includes('umd') || message.includes('bundle')) {
    return 'Ensure your frontend is built as a UMD bundle. Check that vite.config.ts uses createPluginConfig() from @naap/plugin-build/vite and includes a mount.tsx entry point.';
  }

  // Template literal errors (the debugger issue)
  if (message.includes('template') || message.includes('${')) {
    return 'Your build has unresolved template literals. Simplify your vite.config.ts: use shared: ["react", "react-dom"] instead of complex singleton configs, add index.html to your frontend folder';
  }

  // Generic errors
  if (message.includes('required')) {
    return `Add the required "${path}" field to your plugin.json`;
  }

  return null;
}

export const ValidationResults: React.FC<ValidationResultsProps> = ({ result, loading }) => {
  if (loading) {
    return (
      <div className="glass-card p-4">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current text-text-secondary"></div>
          <span className="text-text-secondary">Validating manifest...</span>
        </div>
      </div>
    );
  }

  if (!result) {
    return null;
  }

  return (
    <div className="glass-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        {result.valid ? (
          <>
            <CheckCircle className="w-5 h-5 text-accent-emerald" />
            <span className="text-sm font-semibold text-accent-emerald">Validation Passed</span>
          </>
        ) : (
          <>
            <XCircle className="w-5 h-5 text-accent-rose" />
            <span className="text-sm font-semibold text-accent-rose">Validation Failed</span>
          </>
        )}
      </div>

      {/* Errors */}
      {result.errors.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-accent-rose flex items-center gap-2">
            <XCircle className="w-4 h-4" />
            Errors ({result.errors.length})
          </h4>
          <ul className="space-y-2">
            {result.errors.map((error, i) => (
              <li key={i} className="p-2.5 bg-accent-rose/10 border border-accent-rose/30 rounded-md">
                <div className="font-mono text-sm text-accent-rose">{error.path || 'root'}</div>
                <div className="text-sm text-text-primary mt-1">{error.message}</div>
                {error.value !== undefined && (
                  <div className="text-xs text-text-secondary mt-1">
                    Value: {JSON.stringify(error.value)}
                  </div>
                )}
                {/* Fix suggestion based on error type */}
                {getFixSuggestion(error) && (
                  <div className="mt-2 p-2 bg-accent-amber/10 border border-accent-amber/30 rounded text-xs">
                    <span className="font-medium text-accent-amber">How to fix: </span>
                    <span className="text-text-primary">{getFixSuggestion(error)}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-accent-amber flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Warnings ({result.warnings.length})
          </h4>
          <ul className="space-y-2">
            {result.warnings.map((warning, i) => (
              <li key={i} className="p-2.5 bg-accent-amber/10 border border-accent-amber/30 rounded-md">
                <div className="font-mono text-sm text-accent-amber">{warning.path}</div>
                <div className="text-sm text-text-primary mt-1">{warning.message}</div>
                {warning.suggestion && (
                  <div className="text-xs text-text-secondary mt-1">
                    Suggestion: {warning.suggestion}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Success message */}
      {result.valid && result.errors.length === 0 && (
        <p className="text-sm text-text-secondary">
          Your plugin manifest is valid and ready to publish.
          {result.warnings.length > 0 && ' Consider addressing the warnings above for best results.'}
        </p>
      )}
    </div>
  );
};
