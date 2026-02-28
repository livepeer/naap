import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  Github,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  FileJson,
  Play,
  Rocket,
  FolderOpen,
  Key,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { ValidationResults } from '../components/ValidationResults';
import { validateManifest, uploadPlugin, publishPackage, testPluginLoad, hasApiTokens, type ValidationResult } from '../lib/api';
import { useNotify } from '@naap/plugin-sdk';

type SourceType = 'local' | 'github' | 'dockerhub';
type Step = 'source' | 'upload' | 'validate' | 'test' | 'publish';

const STEPS: { id: Step; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'source', label: 'Source', icon: FolderOpen },
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'validate', label: 'Validate', icon: FileJson },
  { id: 'test', label: 'Test', icon: Play },
  { id: 'publish', label: 'Publish', icon: Rocket },
];

export const PublishWizard: React.FC = () => {
  const navigate = useNavigate();
  const notify = useNotify();

  const [step, setStep] = React.useState<Step>('source');
  const [sourceType, setSourceType] = React.useState<SourceType | null>(null);

  // Upload state
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadResult, setUploadResult] = React.useState<{
    frontendUrl: string;
    backendUrl?: string;
    manifest: Record<string, unknown>;
    deploymentType?: 'cdn' | 'unknown';
    productionManifest?: Record<string, unknown>;
  } | null>(null);

  // GitHub state
  const [githubRepo, setGithubRepo] = React.useState('');
  const [githubTag, setGithubTag] = React.useState('');

  // Validation state
  const [validating, setValidating] = React.useState(false);
  const [validation, setValidation] = React.useState<ValidationResult | null>(null);

  // Test state
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{
    success: boolean;
    error?: string;
    loadTime?: number;
  } | null>(null);

  // Publish state
  const [releaseNotes, setReleaseNotes] = React.useState('');
  const [pricing, setPricing] = React.useState<'free' | 'paid'>('free');
  const [publishing, setPublishing] = React.useState(false);
  const [hasTokens, setHasTokens] = React.useState<boolean | null>(null);
  const [checkingTokens, setCheckingTokens] = React.useState(false);

  const currentStepIndex = STEPS.findIndex(s => s.id === step);

  // Check for API tokens when reaching publish step
  React.useEffect(() => {
    if (step === 'publish' && hasTokens === null && !checkingTokens) {
      setCheckingTokens(true);
      hasApiTokens()
        .then(result => setHasTokens(result))
        .catch(() => setHasTokens(false))
        .finally(() => setCheckingTokens(false));
    }
  }, [step]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    try {
      const result = await uploadPlugin(file);
      setUploadResult(result);
      setStep('validate');
      // Auto-validate
      handleValidate(result.manifest);
    } catch (error) {
      console.error('Upload failed:', error);
      notify.error('Failed to upload plugin');
    } finally {
      setUploading(false);
    }
  };

  const handleValidate = async (manifest?: Record<string, unknown>) => {
    const manifestToValidate = manifest || uploadResult?.manifest;
    if (!manifestToValidate) return;

    setValidating(true);
    try {
      const result = await validateManifest(manifestToValidate);
      setValidation(result);
      if (result.valid) {
        notify.success('Manifest validation passed');
      }
    } catch (error) {
      console.error('Validation failed:', error);
      notify.error('Failed to validate manifest');
    } finally {
      setValidating(false);
    }
  };

  const handleTest = async () => {
    if (!uploadResult?.frontendUrl) return;

    setTesting(true);
    try {
      const result = await testPluginLoad(uploadResult.frontendUrl);
      setTestResult(result);
      if (result.success) {
        notify.success(`Plugin loaded in ${result.loadTime}ms`);
      } else {
        notify.error(`Test failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Test failed:', error);
      notify.error('Failed to test plugin');
      setTestResult({ success: false, error: 'Test request failed' });
    } finally {
      setTesting(false);
    }
  };

  const handlePublish = async () => {
    if (!uploadResult || !validation?.valid) return;

    setPublishing(true);
    try {
      await publishPackage({
        manifest: uploadResult.manifest,
        frontendUrl: uploadResult.frontendUrl,
        backendImage: uploadResult.backendUrl,
        releaseNotes,
      });
      notify.success('Plugin published successfully!');
      navigate('/plugins');
    } catch (error) {
      console.error('Publish failed:', error);
      notify.error('Failed to publish plugin');
    } finally {
      setPublishing(false);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 'source':
        return sourceType !== null;
      case 'upload':
        return file !== null || (sourceType === 'github' && githubRepo);
      case 'validate':
        return validation?.valid === true;
      case 'test':
        return testResult?.success === true;
      case 'publish':
        return true;
      default:
        return false;
    }
  };

  const nextStep = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS.length) {
      setStep(STEPS[nextIndex].id);
    }
  };

  const prevStep = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setStep(STEPS[prevIndex].id);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Publish New Plugin" subtitle="Step-by-step wizard to publish your plugin" />

      {/* Progress Steps */}
      <div className="glass-card p-3">
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.id}>
              <div
                className={`flex items-center gap-2 ${
                  i <= currentStepIndex ? 'text-accent-emerald' : 'text-text-secondary'
                }`}
              >
                <div
                  className={`p-1.5 rounded-md ${
                    i < currentStepIndex
                      ? 'bg-accent-emerald text-white'
                      : i === currentStepIndex
                      ? 'bg-accent-emerald/20 text-accent-emerald'
                      : 'bg-bg-tertiary'
                  }`}
                >
                  {i < currentStepIndex ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : (
                    <s.icon className="w-4 h-4" />
                  )}
                </div>
                <span className="font-medium hidden sm:block">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-4 ${
                    i < currentStepIndex ? 'bg-accent-emerald' : 'bg-bg-tertiary'
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="glass-card p-4">
        {/* Step 1: Source Selection */}
        {step === 'source' && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary">Select Plugin Source</h2>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'local' as const, label: 'Local Upload', icon: Upload, desc: 'Upload a built plugin.zip' },
                { id: 'github' as const, label: 'GitHub', icon: Github, desc: 'Import from GitHub release' },
              ].map((source) => (
                <button
                  key={source.id}
                  onClick={() => setSourceType(source.id)}
                  className={`p-4 rounded-lg border text-left transition-all ${
                    sourceType === source.id
                      ? 'border-accent-emerald bg-accent-emerald/10'
                      : 'border-white/10 hover:border-white/20 bg-bg-tertiary'
                  }`}
                >
                  <source.icon className={`w-5 h-5 mb-2 ${sourceType === source.id ? 'text-accent-emerald' : 'text-text-secondary'}`} />
                  <h3 className="font-medium text-text-primary">{source.label}</h3>
                  <p className="text-sm text-text-secondary mt-1">{source.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Upload/Configure */}
        {step === 'upload' && sourceType === 'local' && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary">Upload Plugin</h2>
            <p className="text-sm text-text-secondary">
              Upload a .zip file containing your built UMD production plugin bundle.
            </p>
            <div
              className="border-2 border-dashed border-white/20 rounded-lg p-6 text-center hover:border-accent-emerald/50 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dropped = e.dataTransfer.files[0];
                if (dropped) setFile(dropped);
              }}
            >
              {file ? (
                <div>
                  <CheckCircle className="w-8 h-8 text-accent-emerald mx-auto mb-4" />
                  <p className="font-medium text-text-primary">{file.name}</p>
                  <p className="text-sm text-text-secondary mt-1">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <button
                    onClick={() => setFile(null)}
                    className="mt-4 text-sm text-accent-rose hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div>
                  <Upload className="w-8 h-8 text-text-secondary mx-auto mb-4" />
                  <p className="text-text-primary mb-2">Drag and drop your plugin.zip here</p>
                  <p className="text-sm text-text-secondary mb-4">or</p>
                  <label className="btn-primary cursor-pointer">
                    Browse Files
                    <input
                      type="file"
                      accept=".zip"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </label>
                  <p className="text-xs text-text-secondary mt-4">
                    Build with <code className="px-1 bg-bg-tertiary rounded">npm run build</code> to create the UMD production bundle
                  </p>
                </div>
              )}
            </div>
            {file && (
              <button onClick={handleUpload} className="btn-primary w-full" disabled={uploading}>
                {uploading ? 'Uploading...' : 'Upload and Continue'}
              </button>
            )}
          </div>
        )}

        {step === 'upload' && sourceType === 'github' && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary">GitHub Repository</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Repository (owner/repo)
                </label>
                <input
                  type="text"
                  value={githubRepo}
                  onChange={(e) => setGithubRepo(e.target.value)}
                  placeholder="e.g., myorg/my-plugin"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Release Tag (optional)
                </label>
                <input
                  type="text"
                  value={githubTag}
                  onChange={(e) => setGithubTag(e.target.value)}
                  placeholder="e.g., v1.0.0 (leave empty for latest)"
                  className="input-field"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Validate */}
        {step === 'validate' && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary">Validate Manifest</h2>
            
            {/* Deployment type info */}
            {uploadResult?.deploymentType && (
              <div className="glass-card p-4 flex items-center gap-3">
                <span className={`badge ${
                  uploadResult.deploymentType === 'cdn' ? 'badge-success' : 'badge-info'
                }`}>
                  {uploadResult.deploymentType === 'cdn' ? 'UMD/CDN' : 'Unknown'}
                </span>
                <span className="text-sm text-text-secondary">
                  {uploadResult.deploymentType === 'cdn' 
                    ? 'Production UMD bundle detected - ready for CDN deployment'
                    : 'Build type could not be determined'}
                </span>
              </div>
            )}

            <ValidationResults result={validation} loading={validating} />
            {!validation && !validating && (
              <button onClick={() => handleValidate()} className="btn-primary">
                Run Validation
              </button>
            )}
          </div>
        )}

        {/* Step 4: Test */}
        {step === 'test' && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary">Test Plugin Loading</h2>
            {testResult ? (
              <div className={`glass-card p-4 ${testResult.success ? 'border-accent-emerald/50' : 'border-accent-rose/50'}`}>
                <div className="flex items-center gap-3">
                  {testResult.success ? (
                    <>
                      <CheckCircle className="w-6 h-6 text-accent-emerald" />
                      <div>
                        <h3 className="font-medium text-accent-emerald">Test Passed</h3>
                        <p className="text-sm text-text-secondary">
                          Plugin loaded successfully in {testResult.loadTime}ms
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-6 h-6 rounded-full bg-accent-rose/20 flex items-center justify-center">
                        <span className="text-accent-rose">✕</span>
                      </div>
                      <div>
                        <h3 className="font-medium text-accent-rose">Test Failed</h3>
                        <p className="text-sm text-text-secondary">{testResult.error}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Play className="w-8 h-8 text-text-secondary mx-auto mb-4" />
                <p className="text-text-secondary mb-4">
                  Test that your plugin can be loaded by the shell application.
                </p>
                <button onClick={handleTest} className="btn-primary" disabled={testing}>
                  {testing ? 'Testing...' : 'Run Test'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 5: Publish */}
        {step === 'publish' && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary">Publish to Marketplace</h2>

            {/* API Token Requirement */}
            {checkingTokens ? (
              <div className="glass-card p-4 flex items-center gap-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current text-text-secondary"></div>
                <span className="text-text-secondary">Checking API token...</span>
              </div>
            ) : hasTokens === false ? (
              <div className="glass-card p-4 border-accent-amber/50">
                <div className="flex items-start gap-4">
                  <div className="p-2 bg-accent-amber/20 rounded-lg">
                    <Key className="w-6 h-6 text-accent-amber" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-text-primary mb-2">API Token Required</h3>
                    <p className="text-sm text-text-secondary mb-4">
                      You need an API token to publish plugins. Tokens authenticate your publishing identity and track who published each plugin.
                    </p>
                    <button
                      onClick={() => navigate('/tokens')}
                      className="btn-secondary text-sm"
                    >
                      Create API Token
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="glass-card p-4 flex items-center gap-3 border-accent-emerald/30">
                <CheckCircle className="w-5 h-5 text-accent-emerald" />
                <span className="text-text-secondary text-sm">API token verified - ready to publish</span>
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Release Notes
              </label>
              <textarea
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
                placeholder="What's new in this version..."
                className="input-field h-32 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Pricing
              </label>
              <div className="flex gap-4">
                <button
                  onClick={() => setPricing('free')}
                  className={`flex-1 p-3 rounded-lg border ${
                    pricing === 'free' ? 'border-accent-emerald bg-accent-emerald/10' : 'border-white/10'
                  }`}
                >
                  <span className="font-medium">Free</span>
                </button>
                <button
                  onClick={() => setPricing('paid')}
                  className={`flex-1 p-3 rounded-lg border ${
                    pricing === 'paid' ? 'border-accent-emerald bg-accent-emerald/10' : 'border-white/10'
                  }`}
                  disabled
                >
                  <span className="font-medium">Paid</span>
                  <span className="text-xs text-text-secondary block">Coming Soon</span>
                </button>
              </div>
            </div>

            <button
              onClick={handlePublish}
              className="btn-primary w-full"
              disabled={publishing || hasTokens === false}
            >
              {publishing ? 'Publishing...' : 'Publish Plugin'}
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={prevStep}
          disabled={currentStepIndex === 0}
          className="btn-secondary flex items-center gap-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        {step !== 'publish' && (
          <button
            onClick={nextStep}
            disabled={!canProceed()}
            className="btn-primary flex items-center gap-2"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
