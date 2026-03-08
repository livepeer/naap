import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Rocket, RefreshCw, Trash2, ExternalLink, Home, Check } from 'lucide-react';
import { useProviders, useGpuOptions, useCredentialStatus } from '../hooks/useProviders';
import { ProviderSelector } from '../components/ProviderSelector';
import { ProviderCredentialConfig } from '../components/ProviderCredentialConfig';
import { SshHostConfig } from '../components/SshHostConfig';
import { GpuConfigForm } from '../components/GpuConfigForm';
import { TemplateSelector } from '../components/TemplateSelector';
import { HealthIndicator } from '../components/HealthIndicator';
import { DeploymentLogs } from '../components/DeploymentLogs';
import { CostPreview } from '../components/CostPreview';
import { EnvVarsEditor } from '../components/EnvVarsEditor';
import { LivepeerConfigForm, type LivepeerConfig } from '../components/LivepeerConfigForm';
import { apiFetch } from '../lib/apiFetch';

interface SelectedTemplate {
  id: string;
  name: string;
  dockerImage: string;
  healthEndpoint: string;
  healthPort: number;
  defaultGpuModel?: string;
  defaultGpuVramGb?: number;
  category: 'curated' | 'custom';
}

export const DeploymentWizard: React.FC = () => {
  const navigate = useNavigate();
  const { providers } = useProviders();
  const [step, setStep] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const [deployedId, setDeployedId] = useState<string | null>(null);
  const [deployStatus, setDeployStatus] = useState<string>('');
  const [healthStatus, setHealthStatus] = useState<string>('UNKNOWN');
  const [deployError, setDeployError] = useState<string | null>(null);
  const [destroying, setDestroying] = useState(false);

  const [selectedTemplate, setSelectedTemplate] = useState<SelectedTemplate | null>(null);
  const isLivepeer = selectedTemplate?.id === 'livepeer-inference';
  const STEPS = isLivepeer
    ? ['Template', 'Inference Config', 'Resources', 'Deploy & Monitor']
    : ['Template', 'Resources', 'Deploy & Monitor'];

  const [livepeerConfig, setLivepeerConfig] = useState<LivepeerConfig>({
    topology: 'split-cpu-serverless',
    serverlessProvider: '',
    serverlessModelId: '',
    serverlessApiKey: '',
    serverlessEndpointUrl: '',
    modelImage: '',
    capacity: 1,
    pricePerUnit: 1200,
    publicAddress: '',
    capabilityName: '',
  });

  const [form, setForm] = useState({
    name: '',
    providerSlug: '',
    sshHost: '',
    sshPort: 22,
    sshUsername: 'deploy',
    gpuModel: '',
    gpuVramGb: 0,
    gpuCount: 1,
    artifactType: '',
    artifactVersion: '',
    dockerImage: '',
    healthPort: 8080,
    healthEndpoint: '/health',
    customImage: '',
    envVars: {} as Record<string, string>,
    concurrency: 1,
  });

  const [sshTestResult, setSshTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const selectedProvider = providers.find((p) => p.slug === form.providerSlug);
  const isSSH = selectedProvider?.mode === 'ssh-bridge';
  const { gpuOptions } = useGpuOptions(form.providerSlug || null);
  const isCustom = selectedTemplate?.category === 'custom';
  const { credentialStatus, refreshCredentials } = useCredentialStatus(form.providerSlug || null);
  const [childCredentialsConfigured, setChildCredentialsConfigured] = useState(false);
  const credentialsReady = isSSH || !form.providerSlug || childCredentialsConfigured || (credentialStatus?.configured ?? false);

  const updateForm = (key: string, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSelectTemplate = (template: any) => {
    setSelectedTemplate(template);
    updateForm('artifactType', template.id);
    updateForm('healthPort', template.healthPort);
    updateForm('healthEndpoint', template.healthEndpoint);
    if (template.dockerImage) {
      updateForm('dockerImage', template.dockerImage);
    }
    if (template.defaultGpuModel) {
      updateForm('gpuModel', template.defaultGpuModel);
    }
    if (template.defaultGpuVramGb) {
      updateForm('gpuVramGb', template.defaultGpuVramGb);
    }
    if (template.id === 'livepeer-inference') {
      updateForm('providerSlug', 'ssh-compose');
    }
  };

  const resourceStep = isLivepeer ? 2 : 1;
  const deployStep = isLivepeer ? 3 : 2;
  const livepeerStep = 1;

  const canProceed = (): boolean => {
    if (step === 0) {
      if (!selectedTemplate) return false;
      if (isCustom) return !!form.customImage;
      return !!(form.artifactVersion || selectedTemplate.dockerImage);
    }
    if (isLivepeer && step === livepeerStep) {
      const lc = livepeerConfig;
      if (lc.topology === 'split-cpu-serverless') {
        if (lc.serverlessProvider === 'custom') return !!lc.serverlessEndpointUrl;
        return !!(lc.serverlessProvider && lc.serverlessModelId && lc.serverlessApiKey);
      }
      return !!lc.modelImage;
    }
    if (step === resourceStep) {
      if (!form.providerSlug || !form.gpuModel) return false;
      if (isSSH) return !!(form.sshHost && form.sshUsername);
      if (!credentialsReady) return false;
      return true;
    }
    if (step === deployStep) return true;
    return false;
  };

  const generateName = useCallback(() => {
    if (!form.name && selectedTemplate && form.providerSlug) {
      const prefix = selectedTemplate.id === 'custom' ? 'custom' : selectedTemplate.id;
      const suffix = form.providerSlug.replace(/-/g, '');
      updateForm('name', `${prefix}-${suffix}-${Date.now().toString(36)}`);
    }
  }, [form.name, selectedTemplate, form.providerSlug]);

  useEffect(() => {
    if (step === 2) generateName();
  }, [step, generateName]);

  const testSshConnection = async () => {
    try {
      setSshTestResult(null);
      const res = await apiFetch('/credentials/ssh-bridge/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: form.sshHost,
          port: form.sshPort,
          username: form.sshUsername,
        }),
      });
      const data = await res.json();
      if (data.success && data.data?.success) {
        setSshTestResult({ success: true, message: 'Connection successful' });
      } else {
        setSshTestResult({ success: false, message: data.data?.error || data.error || 'Connection failed' });
      }
    } catch (err: any) {
      setSshTestResult({ success: false, message: err.message });
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    setDeployError(null);
    setDeployStatus('Creating...');

    const dockerImage = isCustom
      ? form.customImage
      : form.dockerImage;

    const payload: Record<string, unknown> = {
      name: form.name,
      providerSlug: form.providerSlug,
      gpuModel: form.gpuModel,
      gpuVramGb: form.gpuVramGb,
      gpuCount: form.gpuCount,
      artifactType: form.artifactType,
      artifactVersion: isCustom ? 'latest' : (form.artifactVersion || 'latest'),
      dockerImage,
      healthPort: form.healthPort,
      healthEndpoint: form.healthEndpoint,
      sshHost: isSSH ? form.sshHost : undefined,
      sshPort: isSSH ? form.sshPort : undefined,
      sshUsername: isSSH ? form.sshUsername : undefined,
      templateId: selectedTemplate?.id,
      envVars: form.envVars,
      concurrency: form.concurrency,
    };

    if (isLivepeer) {
      payload.livepeerConfig = livepeerConfig;
    }

    try {
      const createRes = await apiFetch('/deployments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const createData = await createRes.json();
      if (!createData.success) throw new Error(createData.error);

      const id = createData.data.id;
      setDeployedId(id);
      setDeployStatus('Deploying...');

      const deployRes = await apiFetch(`/deployments/${id}/deploy`, { method: 'POST' });
      const deployData = await deployRes.json();

      if (deployData.success) {
        setDeployStatus(deployData.data.status);
        setHealthStatus(deployData.data.healthStatus || 'UNKNOWN');
      } else {
        setDeployError(deployData.error);
        setDeployStatus('FAILED');
      }
    } catch (err: any) {
      setDeployError(err.message);
      setDeployStatus('FAILED');
    } finally {
      setDeploying(false);
    }
  };

  useEffect(() => {
    if (!deployedId || deploying) return;
    if (['DESTROYED', 'ONLINE', 'FAILED'].includes(deployStatus)) return;

    const poll = async () => {
      try {
        const inProgress = ['PROVISIONING', 'DEPLOYING', 'VALIDATING'].includes(deployStatus);
        const path = inProgress
          ? `/deployments/${deployedId}/sync-status`
          : `/deployments/${deployedId}`;
        const res = await apiFetch(path, inProgress ? { method: 'POST' } : undefined);
        const data = await res.json();
        if (data.success && data.data) {
          setDeployStatus(data.data.status);
          setHealthStatus(data.data.healthStatus || 'UNKNOWN');
          if (data.data.statusMessage) {
            setDeployError(data.data.statusMessage);
          }
        }
      } catch {
        // ignore
      }
    };

    poll();
    const timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, [deployedId, deploying, deployStatus]);

  const renderStep0 = () => (
    <TemplateSelector
      selectedTemplateId={selectedTemplate?.id || null}
      selectedVersion={form.artifactVersion || null}
      customImage={form.customImage}
      customHealthPort={form.healthPort}
      customHealthEndpoint={form.healthEndpoint}
      onSelectTemplate={handleSelectTemplate}
      onSelectVersion={(version, dockerImage) => {
        updateForm('artifactVersion', version);
        updateForm('dockerImage', dockerImage);
      }}
      onCustomImageChange={(image) => updateForm('customImage', image)}
      onCustomHealthPortChange={(port) => updateForm('healthPort', port)}
      onCustomHealthEndpointChange={(endpoint) => updateForm('healthEndpoint', endpoint)}
    />
  );

  const renderStep1 = () => (
    <div>
      <h3 className="text-base font-semibold mb-1 text-foreground">Configure Resources</h3>
      <p className="text-muted-foreground text-sm mb-6">
        Select your compute provider, GPU, and name your deployment.
      </p>

      <div className="bg-secondary/50 rounded-lg p-5 mb-5">
        <label className="text-xs font-medium block mb-1.5 text-muted-foreground">
          Deployment Name
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => updateForm('name', e.target.value)}
          placeholder="my-deployment"
          className="w-full max-w-md h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Leave blank to auto-generate.
        </p>
      </div>

      <div className="mb-5">
        <h4 className="text-sm font-medium mb-3 text-foreground">Provider</h4>
        <ProviderSelector
          providers={providers}
          selected={form.providerSlug}
          onSelect={(slug) => updateForm('providerSlug', slug)}
        />
      </div>

      {selectedProvider && (
        <div className="mb-5">
          <ProviderCredentialConfig
            provider={selectedProvider}
            compact
            onStatusChange={(configured) => {
              setChildCredentialsConfigured(configured);
              if (configured) refreshCredentials();
            }}
          />
        </div>
      )}

      {isSSH && (
        <div className="mb-5">
          <SshHostConfig
            host={form.sshHost}
            port={form.sshPort}
            username={form.sshUsername}
            onChange={(field, value) => updateForm(field, value)}
            onTestConnection={testSshConnection}
            testResult={sshTestResult}
          />
        </div>
      )}

      {form.providerSlug && (
        <div className="mb-5">
          <GpuConfigForm
            gpuOptions={gpuOptions}
            selectedGpu={form.gpuModel}
            gpuCount={form.gpuCount}
            onSelectGpu={(id) => {
              const gpu = gpuOptions.find((g) => g.id === id);
              updateForm('gpuModel', id);
              if (gpu) updateForm('gpuVramGb', gpu.vramGb);
            }}
            onGpuCountChange={(count) => updateForm('gpuCount', count)}
          />
          <CostPreview
            providerSlug={form.providerSlug || null}
            gpuModel={form.gpuModel || null}
            gpuCount={form.gpuCount}
          />
        </div>
      )}

      <div className="bg-secondary/50 rounded-lg p-5 mb-5">
        <label className="text-xs font-medium block mb-1.5 text-muted-foreground">
          Concurrency
        </label>
        <input
          type="number"
          min={1}
          max={32}
          value={form.concurrency}
          onChange={(e) => updateForm('concurrency', Math.max(1, parseInt(e.target.value, 10) || 1))}
          className="w-24 h-9 px-3 border border-border rounded-md text-sm text-foreground bg-background"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Max concurrent requests per replica.
        </p>
      </div>

      <div className="mb-5">
        <EnvVarsEditor
          envVars={form.envVars}
          onChange={(envVars) => updateForm('envVars', envVars)}
        />
      </div>
    </div>
  );

  const renderStep2 = () => {
    const dockerImage = isCustom ? form.customImage : form.dockerImage;
    const hasDeployed = !!deployedId;

    return (
      <div>
        <h3 className="text-base font-semibold mb-4 text-foreground">Deploy & Monitor</h3>

        {/* Summary */}
        <div className="bg-secondary rounded-lg p-4 mb-6">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Template</span>
              <span className="text-foreground font-medium">{selectedTemplate?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Provider</span>
              <span className="text-foreground font-medium">{selectedProvider?.displayName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">GPU</span>
              <span className="text-foreground font-medium">{form.gpuModel} x{form.gpuCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Version</span>
              <span className="text-foreground font-medium">{isCustom ? 'latest' : (form.artifactVersion || 'latest')}</span>
            </div>
            {isSSH && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Host</span>
                <span className="text-foreground font-medium">{form.sshHost}:{form.sshPort}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Concurrency</span>
              <span className="text-foreground font-medium">{form.concurrency}</span>
            </div>
            <div className="col-span-2 pt-2 border-t border-border mt-1">
              <span className="text-muted-foreground text-xs">Image</span>
              <code className="block text-xs text-foreground font-mono mt-0.5 break-all">{dockerImage}</code>
            </div>
          </div>
        </div>

        {/* Deploy button or status */}
        {!hasDeployed ? (
          <button
            onClick={handleDeploy}
            disabled={deploying}
            className={`h-11 px-8 border-none rounded-md flex items-center gap-2 font-medium text-sm text-white ${
              deploying ? 'bg-zinc-400 cursor-not-allowed' : 'bg-emerald-500 cursor-pointer hover:bg-emerald-600'
            } transition-colors`}
          >
            {deploying ? (
              <><RefreshCw size={16} className="dm-spin" /> Deploying...</>
            ) : (
              <><Rocket size={16} /> Deploy Now</>
            )}
          </button>
        ) : (
          <div>
            {/* Live status */}
            <div className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-5 border ${
              deployStatus === 'ONLINE'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
                : deployStatus === 'FAILED'
                  ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
                  : 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
            }`}>
              <HealthIndicator
                status={deployStatus === 'ONLINE' ? healthStatus : deployStatus === 'FAILED' ? 'RED' : 'UNKNOWN'}
                size={14}
              />
              <div>
                <div className={`font-medium text-sm ${
                  deployStatus === 'ONLINE' ? 'text-emerald-700 dark:text-emerald-300' : deployStatus === 'FAILED' ? 'text-red-600 dark:text-red-400' : 'text-blue-700 dark:text-blue-300'
                }`}>
                  {deployStatus === 'ONLINE' ? 'Deployment Online' :
                   deployStatus === 'FAILED' ? 'Deployment Failed' :
                   deployStatus === 'VALIDATING' ? 'Validating...' :
                   deployStatus === 'DEPLOYING' ? 'Deploying...' :
                   deployStatus}
                </div>
                {deployStatus === 'ONLINE' && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Health: <HealthIndicator status={healthStatus} size={8} showLabel />
                  </div>
                )}
              </div>
            </div>

            {deployError && (
              <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg text-sm mb-4">
                {deployError}
              </div>
            )}

            {deployStatus === 'FAILED' && (
              <button
                onClick={async () => {
                  setDeploying(true);
                  setDeployError(null);
                  try {
                    const res = await apiFetch(`/deployments/${deployedId}/retry`, { method: 'POST' });
                    const data = await res.json();
                    if (data.success) {
                      setDeployStatus(data.data.status);
                    } else {
                      setDeployError(data.error);
                    }
                  } catch (err: any) {
                    setDeployError(err.message);
                  } finally {
                    setDeploying(false);
                  }
                }}
                disabled={deploying}
                className="h-9 px-4 bg-foreground text-background border-none rounded-md cursor-pointer flex items-center gap-2 text-sm font-medium mb-5"
              >
                <RefreshCw size={14} /> Retry
              </button>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap mb-5">
              <button
                onClick={() => navigate('/')}
                className="h-8 px-3 bg-secondary text-secondary-foreground border border-border rounded-md cursor-pointer flex items-center gap-1.5 text-xs font-medium"
              >
                <Home size={12} /> All Deployments
              </button>
              <button
                onClick={() => navigate(`/deployments/${deployedId}`)}
                className="h-8 px-3 bg-secondary text-foreground border border-border rounded-md cursor-pointer flex items-center gap-1.5 text-xs font-medium"
              >
                <ExternalLink size={12} /> View Detail
              </button>
              {!destroying && (
                <button
                  onClick={async () => {
                    if (!confirm('Destroy this deployment? This cannot be undone.')) return;
                    setDestroying(true);
                    try {
                      await apiFetch(`/deployments/${deployedId}`, { method: 'DELETE' });
                      setDeployStatus('DESTROYED');
                    } catch { /* ignore */ }
                    setDestroying(false);
                  }}
                  className="h-8 px-3 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-300 dark:border-red-800 rounded-md cursor-pointer flex items-center gap-1.5 text-xs font-medium"
                >
                  <Trash2 size={12} /> Destroy
                </button>
              )}
            </div>

            <DeploymentLogs deploymentId={deployedId} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="px-6 py-5 max-w-[960px] mx-auto">
      <h1 className="text-xl font-semibold mb-6 text-foreground tracking-tight">New Deployment</h1>

      {/* Step indicator */}
      <div className="flex mb-8">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`flex-1 flex items-center gap-2 pb-3 border-b-2 text-sm ${
              i === step
                ? 'border-foreground text-foreground font-medium'
                : i < step
                  ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                  : 'border-border text-muted-foreground'
            } ${i < step && !deployedId ? 'cursor-pointer' : 'cursor-default'}`}
            onClick={() => i < step && !deployedId && setStep(i)}
          >
            <span
              className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold shrink-0 ${
                i < step
                  ? 'bg-emerald-500 text-white'
                  : i === step
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {i < step ? <Check size={12} /> : i + 1}
            </span>
            <span className="hidden sm:inline">{s}</span>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="min-h-[350px] mb-8">
        {step === 0 && renderStep0()}
        {isLivepeer && step === livepeerStep && (
          <LivepeerConfigForm
            config={livepeerConfig}
            onChange={(field, value) => setLivepeerConfig(prev => ({ ...prev, [field]: value }))}
          />
        )}
        {step === resourceStep && renderStep1()}
        {step === deployStep && renderStep2()}
      </div>

      {/* Navigation */}
      {!deployedId && (
        <div className="flex justify-between">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className={`h-9 px-4 border border-border rounded-md flex items-center gap-2 font-medium text-sm text-muted-foreground ${
              step === 0
                ? 'bg-muted cursor-not-allowed opacity-40'
                : 'bg-secondary cursor-pointer hover:bg-muted transition-colors'
            }`}
          >
            <ArrowLeft size={14} /> Back
          </button>

          <div className="flex items-center gap-4">
            {step === 1 && form.providerSlug && !credentialsReady && (
              <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                Configure credentials above to proceed
              </span>
            )}
            {step < STEPS.length - 1 && (
              <button
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                disabled={!canProceed()}
                className={`h-9 px-5 border-none rounded-md flex items-center gap-2 font-medium text-sm ${
                  canProceed()
                    ? 'bg-foreground text-background cursor-pointer'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                }`}
              >
                Next <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
