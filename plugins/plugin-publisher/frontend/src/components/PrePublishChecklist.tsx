/**
 * Pre-Publish Checklist Component
 * 
 * Displays a comprehensive checklist of validation results
 * before allowing plugin publishing.
 */

import React from 'react';
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Loader2,
  FileCode,
  Server,
  Shield,
  Settings,
  Package,
} from 'lucide-react';

export interface ChecklistItem {
  name: string;
  passed: boolean;
  message: string;
  fix?: string;
  duration?: number;
  icon?: 'code' | 'server' | 'security' | 'settings' | 'package';
}

export interface PrePublishChecklistProps {
  checks: ChecklistItem[];
  loading?: boolean;
  onRetry?: () => void;
}

const iconMap = {
  code: FileCode,
  server: Server,
  security: Shield,
  settings: Settings,
  package: Package,
};

export const PrePublishChecklist: React.FC<PrePublishChecklistProps> = ({
  checks,
  loading,
  onRetry,
}) => {
  const allPassed = checks.length > 0 && checks.every(c => c.passed);
  const failedCount = checks.filter(c => !c.passed).length;

  if (loading) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-text-secondary" />
          <span className="text-text-secondary">Running pre-publish checks...</span>
        </div>
      </div>
    );
  }

  if (checks.length === 0) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 text-text-secondary">
          <Settings className="w-5 h-5" />
          <span>No validation checks have been run yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text-primary">Pre-Publish Validation</h3>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-sm text-accent-blue hover:text-accent-blue/80 flex items-center gap-1"
          >
            <Loader2 className="w-4 h-4" />
            Run Again
          </button>
        )}
      </div>

      {/* Summary */}
      <div className={`flex items-center gap-2 p-3 rounded-lg ${
        allPassed 
          ? 'bg-accent-emerald/10 border border-accent-emerald/30' 
          : 'bg-accent-rose/10 border border-accent-rose/30'
      }`}>
        {allPassed ? (
          <>
            <CheckCircle className="w-5 h-5 text-accent-emerald" />
            <span className="text-accent-emerald font-medium">
              All {checks.length} checks passed - Ready to publish!
            </span>
          </>
        ) : (
          <>
            <XCircle className="w-5 h-5 text-accent-rose" />
            <span className="text-accent-rose font-medium">
              {failedCount} of {checks.length} checks failed
            </span>
          </>
        )}
      </div>

      {/* Checklist */}
      <div className="space-y-3">
        {checks.map((check, i) => {
          const IconComponent = check.icon ? iconMap[check.icon] : Settings;
          
          return (
            <div
              key={i}
              className={`p-4 rounded-lg border ${
                check.passed
                  ? 'bg-bg-secondary/30 border-border'
                  : 'bg-accent-rose/5 border-accent-rose/30'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Status Icon */}
                <div className={`mt-0.5 ${check.passed ? 'text-accent-emerald' : 'text-accent-rose'}`}>
                  {check.passed ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    <XCircle className="w-5 h-5" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <IconComponent className="w-4 h-4 text-text-secondary" />
                    <span className={`font-medium ${
                      check.passed ? 'text-text-primary' : 'text-accent-rose'
                    }`}>
                      {check.name}
                    </span>
                    {check.duration && (
                      <span className="text-xs text-text-tertiary">
                        ({check.duration}ms)
                      </span>
                    )}
                  </div>
                  
                  <p className="mt-1 text-sm text-text-secondary">{check.message}</p>
                  
                  {/* Fix suggestion for failed checks */}
                  {!check.passed && check.fix && (
                    <div className="mt-2 p-2 bg-accent-amber/10 border border-accent-amber/30 rounded text-sm">
                      <div className="flex items-center gap-2 text-accent-amber font-medium">
                        <AlertTriangle className="w-4 h-4" />
                        How to fix:
                      </div>
                      <p className="mt-1 text-text-primary">{check.fix}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action guidance */}
      {!allPassed && (
        <div className="p-4 bg-accent-amber/10 border border-accent-amber/30 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-accent-amber flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-accent-amber">
                Fix the issues above before publishing
              </p>
              <p className="mt-1 text-text-secondary">
                All validation checks must pass to ensure your plugin works correctly 
                after installation. Review the fix suggestions for each failed check.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Convert test result to checklist items
 */
export function testResultToChecklist(testResult: {
  success: boolean;
  frontend?: {
    success: boolean;
    bundleValid: boolean;
    globalName: string | null;
    errors: string[];
    warnings: string[];
    loadTime?: number;
    size?: number;
  };
  backend?: {
    success: boolean;
    healthy: boolean;
    responseTime?: number;
    errors: string[];
  };
  overallErrors: string[];
}): ChecklistItem[] {
  const checks: ChecklistItem[] = [];

  // Frontend checks
  if (testResult.frontend) {
    const fe = testResult.frontend;
    
    checks.push({
      name: 'UMD Bundle',
      passed: fe.bundleValid,
      message: fe.bundleValid
        ? `Valid UMD bundle${fe.globalName ? ` (${fe.globalName})` : ''}`
        : fe.errors[0] || 'UMD bundle validation failed',
      fix: fe.bundleValid 
        ? undefined 
        : 'Check your vite.config.ts uses createPluginConfig() from @naap/plugin-build/vite and includes a mount.tsx entry point.',
      duration: fe.loadTime,
      icon: 'code',
    });

    checks.push({
      name: 'Frontend Loading',
      passed: fe.success,
      message: fe.success
        ? `Loaded successfully (${(fe.size || 0) / 1024}KB)`
        : fe.errors[0] || 'Frontend failed to load',
      fix: fe.success
        ? undefined
        : 'Ensure your frontend is built and the UMD bundle exists in the dist/production folder.',
      icon: 'package',
    });
  }

  // Backend checks
  if (testResult.backend) {
    const be = testResult.backend;
    
    checks.push({
      name: 'Backend Health',
      passed: be.healthy,
      message: be.healthy
        ? `Healthy (${be.responseTime}ms response)`
        : be.errors[0] || 'Backend health check failed',
      fix: be.healthy
        ? undefined
        : 'Ensure your backend is running and has a /healthz endpoint that returns { status: "healthy" }.',
      duration: be.responseTime,
      icon: 'server',
    });
  }

  return checks;
}
