import React from 'react';
import { Save, Github, User, Link, CheckCircle } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useNotify } from '@naap/plugin-sdk';

export const Settings: React.FC = () => {
  const notify = useNotify();
  // Publisher profile
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [avatarUrl, setAvatarUrl] = React.useState('');

  // GitHub integration
  const [githubOrg, setGithubOrg] = React.useState('');
  const [webhookConfigured, setWebhookConfigured] = React.useState(false);

  const [saving, setSaving] = React.useState(false);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      // TODO: Implement save profile API
      await new Promise(resolve => setTimeout(resolve, 1000));
      notify.success('Profile saved successfully');
    } catch (error) {
      notify.error('Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleConfigureWebhook = async () => {
    if (!githubOrg) {
      notify.error('Please enter a GitHub organization');
      return;
    }

    try {
      // TODO: Implement webhook configuration
      await new Promise(resolve => setTimeout(resolve, 1000));
      setWebhookConfigured(true);
      notify.success('GitHub webhook configured');
    } catch (error) {
      notify.error('Failed to configure webhook');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Publisher Settings"
        subtitle="Configure your publisher profile and integrations"
      />

      {/* Publisher Profile */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-1.5 bg-accent-blue/20 rounded-md">
            <User className="w-4 h-4 text-accent-blue" />
          </div>
          <h2 className="text-sm font-semibold text-text-primary">Publisher Profile</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Publisher Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name or organization"
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@example.com"
              className="input-field"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Avatar URL
            </label>
            <input
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/avatar.png"
              className="input-field"
            />
          </div>
        </div>

        <div className="mt-3">
          <button
            onClick={handleSaveProfile}
            className="btn-primary flex items-center gap-2"
            disabled={saving}
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </div>

      {/* GitHub Integration */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-1.5 bg-bg-tertiary rounded-md">
            <Github className="w-4 h-4 text-text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary">GitHub Integration</h2>
            <p className="text-sm text-text-secondary">
              Auto-publish plugins when you create GitHub releases
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              GitHub Organization / Username
            </label>
            <input
              type="text"
              value={githubOrg}
              onChange={(e) => setGithubOrg(e.target.value)}
              placeholder="e.g., myorg or myusername"
              className="input-field"
            />
          </div>

          {webhookConfigured ? (
            <div className="flex items-center gap-2 text-accent-emerald">
              <CheckCircle className="w-5 h-5" />
              <span>Webhook configured successfully</span>
            </div>
          ) : (
            <button onClick={handleConfigureWebhook} className="btn-secondary flex items-center gap-2">
              <Link className="w-4 h-4" />
              Configure Webhook
            </button>
          )}

          <div className="p-3 bg-bg-tertiary rounded-md">
            <h4 className="font-medium text-text-primary mb-2">Setup Instructions</h4>
            <ol className="text-sm text-text-secondary space-y-2 list-decimal list-inside">
              <li>Go to your GitHub repository settings</li>
              <li>Navigate to Webhooks → Add webhook</li>
              <li>Set Payload URL to: <code className="px-1 bg-bg-secondary rounded">https://api.naap.io/webhooks/github</code></li>
              <li>Set Content type to: <code className="px-1 bg-bg-secondary rounded">application/json</code></li>
              <li>Select "Let me select individual events" and check "Releases"</li>
              <li>Click "Add webhook"</li>
            </ol>
          </div>
        </div>
      </div>

      {/* DockerHub Integration (Future) */}
      <div className="glass-card p-4 opacity-60">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-1.5 bg-accent-blue/20 rounded-md">
            <svg className="w-4 h-4 text-accent-blue" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185zm-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.186zm0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186zm-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186zm-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186zm5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185zm-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185zm-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.185-.186H5.136a.186.186 0 00-.186.185v1.888c0 .102.084.185.186.185zm-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185zM23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288z"/>
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary">DockerHub Integration</h2>
            <p className="text-sm text-text-secondary">Coming soon</p>
          </div>
        </div>
        <p className="text-sm text-text-secondary">
          Auto-deploy backend services when you push Docker images.
        </p>
      </div>
    </div>
  );
};
