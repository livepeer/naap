import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Key } from 'lucide-react';
import type { DeveloperApiKey } from '@naap/types';
import { mockApiKeys, mockUsageRecords } from '../../data/mockData';
import { ApiKeyTable } from '../api-keys/ApiKeyTable';
import { KeyDetailPanel } from '../api-keys/KeyDetailPanel';
import { CreateKeyModal } from '../api-keys/CreateKeyModal';

export const APIKeysTab: React.FC = () => {
  const [keys, setKeys] = useState<DeveloperApiKey[]>(mockApiKeys);
  const [selectedKey, setSelectedKey] = useState<DeveloperApiKey | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [renameModalKey, setRenameModalKey] = useState<DeveloperApiKey | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleCopyKey = async (key: DeveloperApiKey) => {
    await navigator.clipboard.writeText(key.keyHash);
    // Could show toast notification
  };

  const handleRotateKey = (key: DeveloperApiKey) => {
    // In real app, would call API
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let newHash = 'lp_sk_****************************';
    for (let i = 0; i < 4; i++) {
      newHash += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setKeys((prev) =>
      prev.map((k) => (k.id === key.id ? { ...k, keyHash: newHash } : k))
    );
    if (selectedKey?.id === key.id) {
      setSelectedKey({ ...selectedKey, keyHash: newHash });
    }
  };

  const handleRenameKey = (key: DeveloperApiKey) => {
    setRenameModalKey(key);
    setRenameValue(key.projectName);
  };

  const handleRenameSubmit = () => {
    if (!renameModalKey || !renameValue.trim()) return;
    setKeys((prev) =>
      prev.map((k) =>
        k.id === renameModalKey.id ? { ...k, projectName: renameValue.trim() } : k
      )
    );
    if (selectedKey?.id === renameModalKey.id) {
      setSelectedKey({ ...selectedKey, projectName: renameValue.trim() });
    }
    setRenameModalKey(null);
  };

  const handleRevokeKey = (key: DeveloperApiKey) => {
    if (!confirm(`Are you sure you want to revoke the API key for "${key.projectName}"?`)) {
      return;
    }
    setKeys((prev) =>
      prev.map((k) => (k.id === key.id ? { ...k, status: 'revoked' } : k))
    );
    if (selectedKey?.id === key.id) {
      setSelectedKey({ ...selectedKey, status: 'revoked' });
    }
  };

  const handleCreateSuccess = (data: {
    projectName: string;
    modelId: string;
    gatewayId: string;
    rawKey: string;
  }) => {
    // In real app, would use response from API
    const newKey: DeveloperApiKey = {
      id: `key-${Date.now()}`,
      projectName: data.projectName,
      modelId: data.modelId,
      modelName: mockApiKeys[0].modelName, // Would come from API
      gatewayId: data.gatewayId,
      gatewayName: mockApiKeys[0].gatewayName, // Would come from API
      keyHash: data.rawKey.slice(0, 6) + '****************************' + data.rawKey.slice(-4),
      status: 'active',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    setKeys((prev) => [newKey, ...prev]);
    setShowCreateModal(false);
  };

  const activeKeys = keys.filter((k) => k.status === 'active');
  const revokedKeys = keys.filter((k) => k.status === 'revoked');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Your API Keys</h2>
          <p className="text-sm text-text-secondary mt-1">
            Manage credentials for accessing the Livepeer AI network
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-accent-emerald text-white rounded-xl font-bold hover:bg-accent-emerald/90 transition-all"
        >
          <Plus size={18} />
          Create API Key
        </button>
      </div>

      {/* Active Keys */}
      {activeKeys.length > 0 ? (
        <ApiKeyTable
          keys={activeKeys}
          onCopyKey={handleCopyKey}
          onRotateKey={handleRotateKey}
          onRenameKey={handleRenameKey}
          onRevokeKey={handleRevokeKey}
          onViewDetails={setSelectedKey}
        />
      ) : (
        <div className="glass-card p-12 text-center">
          <Key size={48} className="mx-auto mb-4 text-text-secondary opacity-30" />
          <h3 className="text-lg font-bold text-text-primary mb-2">No API Keys Yet</h3>
          <p className="text-text-secondary text-sm mb-6 max-w-md mx-auto">
            Create your first API key to start using the Livepeer AI network in your applications.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-accent-emerald text-white rounded-xl font-bold hover:bg-accent-emerald/90 transition-all"
          >
            <Plus size={18} />
            Create Your First API Key
          </button>
        </div>
      )}

      {/* Revoked Keys */}
      {revokedKeys.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-text-secondary uppercase tracking-widest">
            Revoked Keys
          </h3>
          <ApiKeyTable
            keys={revokedKeys}
            onCopyKey={handleCopyKey}
            onRotateKey={handleRotateKey}
            onRenameKey={handleRenameKey}
            onRevokeKey={handleRevokeKey}
            onViewDetails={setSelectedKey}
          />
        </div>
      )}

      {/* Detail Panel */}
      <AnimatePresence>
        {selectedKey && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
              onClick={() => setSelectedKey(null)}
            />
            <KeyDetailPanel
              apiKey={selectedKey}
              usageRecords={mockUsageRecords.filter((r) => r.keyId === selectedKey.id)}
              onClose={() => setSelectedKey(null)}
              onCopy={() => handleCopyKey(selectedKey)}
              onRotate={() => handleRotateKey(selectedKey)}
              onRename={() => handleRenameKey(selectedKey)}
              onRevoke={() => handleRevokeKey(selectedKey)}
            />
          </>
        )}
      </AnimatePresence>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateKeyModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleCreateSuccess}
        />
      )}

      {/* Rename Modal */}
      {renameModalKey && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-bg-secondary border border-white/10 rounded-2xl w-full max-w-md p-6"
          >
            <h3 className="text-lg font-bold text-text-primary mb-4">Rename Project</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full bg-bg-tertiary border border-white/10 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-accent-emerald transition-all mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => setRenameModalKey(null)}
                className="flex-1 py-2.5 bg-bg-tertiary text-text-primary rounded-xl font-medium hover:bg-bg-tertiary/80 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleRenameSubmit}
                disabled={!renameValue.trim()}
                className="flex-1 py-2.5 bg-accent-emerald text-white rounded-xl font-bold hover:bg-accent-emerald/90 transition-all disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
