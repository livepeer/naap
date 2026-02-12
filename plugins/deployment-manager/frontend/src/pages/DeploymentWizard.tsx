import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Rocket } from 'lucide-react';
import { useProviders, useGpuOptions } from '../hooks/useProviders';
import { ProviderSelector } from '../components/ProviderSelector';
import { SshHostConfig } from '../components/SshHostConfig';
import { GpuConfigForm } from '../components/GpuConfigForm';
import { ArtifactSelector } from '../components/ArtifactSelector';

const API_BASE = '/api/v1/deployment-manager';

const STEPS = ['Provider', 'Host / Auth', 'GPU', 'Artifact', 'Deploy'];

export const DeploymentWizard: React.FC = () => {
  const { providers } = useProviders();
  const [step, setStep] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<{ success: boolean; message: string } | null>(null);

  const [form, setForm] = useState({
    name: '',
    providerSlug: '' as string,
    sshHost: '',
    sshPort: 22,
    sshUsername: 'deploy',
    gpuModel: '' as string,
    gpuVramGb: 0,
    gpuCount: 1,
    artifactType: '' as string,
    artifactVersion: '' as string,
    dockerImage: '' as string,
  });

  const [sshTestResult, setSshTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const selectedProvider = providers.find((p) => p.slug === form.providerSlug);
  const isSSH = selectedProvider?.mode === 'ssh-bridge';
  const { gpuOptions } = useGpuOptions(form.providerSlug || null);

  const updateForm = (key: string, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const canProceed = (): boolean => {
    switch (step) {
      case 0: return !!form.providerSlug;
      case 1: return isSSH ? !!(form.sshHost && form.sshUsername) : true;
      case 2: return !!form.gpuModel;
      case 3: return !!(form.artifactType && form.artifactVersion);
      case 4: return !!form.name;
      default: return false;
    }
  };

  const testSshConnection = async () => {
    try {
      setSshTestResult(null);
      const res = await fetch(`${API_BASE}/providers/ssh-bridge`, { method: 'GET' });
      if (res.ok) {
        setSshTestResult({ success: true, message: 'Provider configured' });
      } else {
        setSshTestResult({ success: false, message: 'Connection test requires configured SSH credentials' });
      }
    } catch (err: any) {
      setSshTestResult({ success: false, message: err.message });
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    setDeployResult(null);
    try {
      const createRes = await fetch(`${API_BASE}/deployments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const createData = await createRes.json();
      if (!createData.success) throw new Error(createData.error);

      const deployRes = await fetch(`${API_BASE}/deployments/${createData.data.id}/deploy`, { method: 'POST' });
      const deployData = await deployRes.json();

      if (deployData.success) {
        setDeployResult({ success: true, message: `Deployment started: ${createData.data.id}` });
      } else {
        setDeployResult({ success: false, message: deployData.error });
      }
    } catch (err: any) {
      setDeployResult({ success: false, message: err.message });
    } finally {
      setDeploying(false);
    }
  };

  const stepContent = () => {
    switch (step) {
      case 0:
        return (
          <ProviderSelector
            providers={providers}
            selected={form.providerSlug}
            onSelect={(slug) => updateForm('providerSlug', slug)}
          />
        );
      case 1:
        return isSSH ? (
          <SshHostConfig
            host={form.sshHost}
            port={form.sshPort}
            username={form.sshUsername}
            onChange={(field, value) => updateForm(field, value)}
            onTestConnection={testSshConnection}
            testResult={sshTestResult}
          />
        ) : (
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Provider Authentication</h3>
            <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>
              Configure your API key for {selectedProvider?.displayName} in the Provider Settings page.
              The service gateway will handle authentication via your stored credentials.
            </p>
          </div>
        );
      case 2:
        return (
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
        );
      case 3:
        return (
          <ArtifactSelector
            selectedType={form.artifactType || null}
            selectedVersion={form.artifactVersion || null}
            onSelectType={(type) => updateForm('artifactType', type)}
            onSelectVersion={(version, dockerImage) => {
              updateForm('artifactVersion', version);
              updateForm('dockerImage', dockerImage);
            }}
          />
        );
      case 4:
        return (
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Review & Deploy</h3>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>
                Deployment Name
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateForm('name', e.target.value)}
                placeholder="my-ai-runner-a100"
                style={{
                  width: '100%',
                  maxWidth: '400px',
                  padding: '0.5rem 0.75rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.375rem',
                }}
              />
            </div>
            <div style={{
              padding: '1rem',
              background: '#f9fafb',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
            }}>
              <div><strong>Provider:</strong> {selectedProvider?.displayName}</div>
              {isSSH && <div><strong>Host:</strong> {form.sshHost}:{form.sshPort}</div>}
              <div><strong>GPU:</strong> {form.gpuModel} x{form.gpuCount}</div>
              <div><strong>Artifact:</strong> {form.artifactType} {form.artifactVersion}</div>
              <div><strong>Image:</strong> <code>{form.dockerImage}</code></div>
            </div>
            {deployResult && (
              <div style={{
                marginTop: '1rem',
                padding: '0.75rem',
                borderRadius: '0.375rem',
                background: deployResult.success ? '#f0fdf4' : '#fef2f2',
                color: deployResult.success ? '#16a34a' : '#dc2626',
                fontSize: '0.875rem',
              }}>
                {deployResult.message}
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
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
              fontSize: '0.8rem',
              fontWeight: i === step ? 600 : 400,
              cursor: i < step ? 'pointer' : 'default',
            }}
            onClick={() => i < step && setStep(i)}
          >
            {s}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div style={{ minHeight: '300px', marginBottom: '2rem' }}>
        {stepContent()}
      </div>

      {/* Navigation */}
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

        {step < STEPS.length - 1 ? (
          <button
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            disabled={!canProceed()}
            style={{
              padding: '0.5rem 1rem',
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
        ) : (
          <button
            onClick={handleDeploy}
            disabled={!canProceed() || deploying}
            style={{
              padding: '0.5rem 1.5rem',
              background: canProceed() && !deploying ? '#22c55e' : '#9ca3af',
              color: '#fff',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: canProceed() && !deploying ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: 600,
            }}
          >
            <Rocket size={16} />
            {deploying ? 'Deploying...' : 'Deploy'}
          </button>
        )}
      </div>
    </div>
  );
};
