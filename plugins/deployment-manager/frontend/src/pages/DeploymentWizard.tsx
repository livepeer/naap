import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, ArrowRight, Rocket, RefreshCw } from 'lucide-react';
import { useProviders, useGpuOptions } from '../hooks/useProviders';
import { ProviderSelector } from '../components/ProviderSelector';
import { SshHostConfig } from '../components/SshHostConfig';
import { GpuConfigForm } from '../components/GpuConfigForm';
import { TemplateSelector } from '../components/TemplateSelector';
import { HealthIndicator } from '../components/HealthIndicator';
import { DeploymentLogs } from '../components/DeploymentLogs';

const API_BASE = '/api/v1/deployment-manager';

const STEPS = ['Template', 'Resources', 'Deploy & Monitor'];

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
  const { providers } = useProviders();
  const [step, setStep] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const [deployedId, setDeployedId] = useState<string | null>(null);
  const [deployStatus, setDeployStatus] = useState<string>('');
  const [healthStatus, setHealthStatus] = useState<string>('UNKNOWN');
  const [deployError, setDeployError] = useState<string | null>(null);

  const [selectedTemplate, setSelectedTemplate] = useState<SelectedTemplate | null>(null);

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
  });

  const [sshTestResult, setSshTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const selectedProvider = providers.find((p) => p.slug === form.providerSlug);
  const isSSH = selectedProvider?.mode === 'ssh-bridge';
  const { gpuOptions } = useGpuOptions(form.providerSlug || null);
  const isCustom = selectedTemplate?.category === 'custom';

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
  };

  const canProceed = (): boolean => {
    switch (step) {
      case 0: {
        if (!selectedTemplate) return false;
        if (isCustom) return !!form.customImage;
        return !!form.artifactVersion;
      }
      case 1:
        if (!form.providerSlug || !form.gpuModel) return false;
        if (isSSH) return !!(form.sshHost && form.sshUsername);
        return true;
      case 2:
        return true;
      default:
        return false;
    }
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
      const res = await fetch('/api/v1/gw/ssh-bridge/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: form.sshHost,
          port: form.sshPort,
          username: form.sshUsername,
        }),
      });
      if (res.ok) {
        setSshTestResult({ success: true, message: 'Connection successful' });
      } else {
        const data = await res.text();
        setSshTestResult({ success: false, message: data || 'Connection failed' });
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

    const payload = {
      name: form.name,
      providerSlug: form.providerSlug,
      gpuModel: form.gpuModel,
      gpuVramGb: form.gpuVramGb,
      gpuCount: form.gpuCount,
      artifactType: form.artifactType,
      artifactVersion: isCustom ? 'latest' : form.artifactVersion,
      dockerImage,
      healthPort: form.healthPort,
      healthEndpoint: form.healthEndpoint,
      sshHost: isSSH ? form.sshHost : undefined,
      sshPort: isSSH ? form.sshPort : undefined,
      sshUsername: isSSH ? form.sshUsername : undefined,
      templateId: selectedTemplate?.id,
    };

    try {
      const createRes = await fetch(`${API_BASE}/deployments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const createData = await createRes.json();
      if (!createData.success) throw new Error(createData.error);

      const id = createData.data.id;
      setDeployedId(id);
      setDeployStatus('Deploying...');

      const deployRes = await fetch(`${API_BASE}/deployments/${id}/deploy`, { method: 'POST' });
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

  // Poll deployment status after deploy
  useEffect(() => {
    if (!deployedId || deploying) return;
    if (deployStatus === 'DESTROYED' || deployStatus === 'FAILED') return;

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/deployments/${deployedId}`);
        const data = await res.json();
        if (data.success) {
          setDeployStatus(data.data.status);
          setHealthStatus(data.data.healthStatus || 'UNKNOWN');
        }
      } catch {
        // ignore
      }
    };

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
      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>Configure Resources</h3>
      <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        Select your compute provider, GPU, and name your deployment.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>
          Deployment Name
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => updateForm('name', e.target.value)}
          placeholder="my-deployment"
          style={{
            width: '100%',
            maxWidth: '400px',
            padding: '0.5rem 0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
          }}
        />
        <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
          Leave blank to auto-generate.
        </p>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>Provider</h4>
        <ProviderSelector
          providers={providers}
          selected={form.providerSlug}
          onSelect={(slug) => updateForm('providerSlug', slug)}
        />
      </div>

      {isSSH && (
        <div style={{ marginBottom: '1.5rem' }}>
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
        <div style={{ marginBottom: '1.5rem' }}>
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
        </div>
      )}
    </div>
  );

  const renderStep2 = () => {
    const dockerImage = isCustom ? form.customImage : form.dockerImage;
    const hasDeployed = !!deployedId;

    return (
      <div>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>Deploy & Monitor</h3>

        {/* Summary */}
        <div style={{
          padding: '1rem',
          background: '#f9fafb',
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          marginBottom: '1.5rem',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <div><strong>Template:</strong> {selectedTemplate?.name}</div>
            <div><strong>Provider:</strong> {selectedProvider?.displayName}</div>
            <div><strong>GPU:</strong> {form.gpuModel} x{form.gpuCount}</div>
            <div><strong>Version:</strong> {isCustom ? 'latest' : form.artifactVersion}</div>
            {isSSH && <div><strong>Host:</strong> {form.sshHost}:{form.sshPort}</div>}
            <div style={{ gridColumn: '1 / -1' }}>
              <strong>Image:</strong> <code style={{ fontSize: '0.8rem' }}>{dockerImage}</code>
            </div>
          </div>
        </div>

        {/* Deploy button or status */}
        {!hasDeployed ? (
          <button
            onClick={handleDeploy}
            disabled={deploying}
            style={{
              padding: '0.75rem 2rem',
              background: deploying ? '#9ca3af' : '#22c55e',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: deploying ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: 600,
              fontSize: '1rem',
            }}
          >
            {deploying ? (
              <><RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} /> Deploying...</>
            ) : (
              <><Rocket size={18} /> Deploy Now</>
            )}
          </button>
        ) : (
          <div>
            {/* Live status */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '1rem',
              background: deployStatus === 'ONLINE' ? '#f0fdf4' : deployStatus === 'FAILED' ? '#fef2f2' : '#f0f9ff',
              borderRadius: '0.5rem',
              marginBottom: '1.5rem',
            }}>
              <HealthIndicator
                status={deployStatus === 'ONLINE' ? healthStatus : deployStatus === 'FAILED' ? 'RED' : 'UNKNOWN'}
                size={20}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                  {deployStatus === 'ONLINE' ? 'Deployment Online' :
                   deployStatus === 'FAILED' ? 'Deployment Failed' :
                   deployStatus === 'VALIDATING' ? 'Validating...' :
                   deployStatus === 'DEPLOYING' ? 'Deploying...' :
                   deployStatus}
                </div>
                {deployStatus === 'ONLINE' && (
                  <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                    Health: <HealthIndicator status={healthStatus} size={8} showLabel />
                  </div>
                )}
              </div>
            </div>

            {deployError && (
              <div style={{
                padding: '0.75rem',
                background: '#fef2f2',
                color: '#dc2626',
                borderRadius: '0.375rem',
                fontSize: '0.875rem',
                marginBottom: '1rem',
              }}>
                {deployError}
              </div>
            )}

            {deployStatus === 'FAILED' && (
              <button
                onClick={async () => {
                  setDeploying(true);
                  setDeployError(null);
                  try {
                    const res = await fetch(`${API_BASE}/deployments/${deployedId}/retry`, { method: 'POST' });
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
                style={{
                  padding: '0.5rem 1.5rem',
                  background: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '1.5rem',
                }}
              >
                <RefreshCw size={16} /> Retry
              </button>
            )}

            {/* Deployment Logs */}
            <DeploymentLogs deploymentId={deployedId} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '960px', margin: '0 auto' }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '2rem' }}>New Deployment</h1>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
        {STEPS.map((s, i) => (
          <div
            key={s}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '0.5rem',
              borderBottom: i === step ? '3px solid #3b82f6' : '3px solid #e5e7eb',
              color: i === step ? '#1d4ed8' : i < step ? '#22c55e' : '#9ca3af',
              fontSize: '0.85rem',
              fontWeight: i === step ? 600 : 400,
              cursor: i < step && !deployedId ? 'pointer' : 'default',
            }}
            onClick={() => i < step && !deployedId && setStep(i)}
          >
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '1.5rem',
              height: '1.5rem',
              borderRadius: '50%',
              background: i < step ? '#22c55e' : i === step ? '#3b82f6' : '#e5e7eb',
              color: i <= step || i < step ? '#fff' : '#9ca3af',
              fontSize: '0.75rem',
              fontWeight: 600,
              marginRight: '0.5rem',
            }}>
              {i + 1}
            </span>
            {s}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div style={{ minHeight: '350px', marginBottom: '2rem' }}>
        {step === 0 && renderStep0()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
      </div>

      {/* Navigation */}
      {!deployedId && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            style={{
              padding: '0.5rem 1rem',
              background: step === 0 ? '#f3f4f6' : '#fff',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              cursor: step === 0 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              opacity: step === 0 ? 0.5 : 1,
            }}
          >
            <ArrowLeft size={16} /> Back
          </button>

          {step < STEPS.length - 1 && (
            <button
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              disabled={!canProceed()}
              style={{
                padding: '0.5rem 1.5rem',
                background: canProceed() ? '#3b82f6' : '#9ca3af',
                color: '#fff',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: canProceed() ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              Next <ArrowRight size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
