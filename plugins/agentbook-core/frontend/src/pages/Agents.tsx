import React, { useEffect, useState } from 'react';
import { Bot, Zap, Brain, FileText, TrendingUp } from 'lucide-react';

const API = '/api/v1/agentbook-core';

const ICONS: Record<string, React.ReactNode> = {
  bookkeeper: <FileText className="w-5 h-5" />,
  'tax-strategist': <Brain className="w-5 h-5" />,
  collections: <Zap className="w-5 h-5" />,
  insights: <TrendingUp className="w-5 h-5" />,
};

interface Agent {
  id: string;
  name: string;
  description: string;
  skills: string[];
  config: {
    aggressiveness: number;
    autoApprove: boolean;
    notificationFrequency: string;
    modelTier: string;
    enabled: boolean;
  };
}

export const AgentsPage: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/agents`).then(r => r.json())
      .then(d => { if (d.data) setAgents(d.data); })
      .finally(() => setLoading(false));
  }, []);

  const updateConfig = async (agentId: string, field: string, value: any) => {
    setSaving(agentId);
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, config: { ...a.config, [field]: value } } : a));

    await fetch(`${API}/agents/${agentId}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    setSaving(null);
  };

  if (loading) return <div className="p-6 text-muted-foreground">Loading agents...</div>;

  return (
    <div className="px-4 py-5 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Bot className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">AI Agents</h1>
          <p className="text-sm text-muted-foreground">Configure how each agent works for you</p>
        </div>
      </div>

      <div className="space-y-4">
        {agents.map(agent => (
          <div key={agent.id} className={`bg-card border rounded-xl p-5 transition-all ${agent.config.enabled ? 'border-border' : 'border-border opacity-60'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">{ICONS[agent.id]}</div>
                <div>
                  <h3 className="font-medium">{agent.name}</h3>
                  <p className="text-xs text-muted-foreground">{agent.description}</p>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={agent.config.enabled}
                  onChange={e => updateConfig(agent.id, 'enabled', e.target.checked)}
                  className="rounded" />
                <span className="text-xs">{agent.config.enabled ? 'Active' : 'Disabled'}</span>
              </label>
            </div>

            {agent.config.enabled && (
              <div className="space-y-4 pt-3 border-t border-border">
                {/* Aggressiveness slider */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Approach</span>
                    <span>{agent.config.aggressiveness < 0.3 ? 'Gentle' : agent.config.aggressiveness < 0.7 ? 'Balanced' : 'Assertive'}</span>
                  </div>
                  <input type="range" min="0" max="1" step="0.1" value={agent.config.aggressiveness}
                    onChange={e => updateConfig(agent.id, 'aggressiveness', parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-muted rounded-full appearance-none cursor-pointer" />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                    <span>Gentle</span><span>Assertive</span>
                  </div>
                </div>

                {/* Auto-approve toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm">Auto-approve actions</p>
                    <p className="text-xs text-muted-foreground">Execute without asking first</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={agent.config.autoApprove}
                      onChange={e => updateConfig(agent.id, 'autoApprove', e.target.checked)}
                      className="sr-only peer" />
                    <div className="w-9 h-5 bg-muted peer-checked:bg-primary rounded-full peer-focus:ring-2 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                  </label>
                </div>

                {/* Notification frequency */}
                <div className="flex items-center justify-between">
                  <span className="text-sm">Notifications</span>
                  <select value={agent.config.notificationFrequency}
                    onChange={e => updateConfig(agent.id, 'notificationFrequency', e.target.value)}
                    className="text-sm p-1.5 border border-border rounded-lg bg-background">
                    <option value="realtime">Real-time</option>
                    <option value="daily">Daily digest</option>
                    <option value="weekly">Weekly summary</option>
                  </select>
                </div>

                {/* Model tier */}
                <div className="flex items-center justify-between">
                  <span className="text-sm">AI Model</span>
                  <select value={agent.config.modelTier}
                    onChange={e => updateConfig(agent.id, 'modelTier', e.target.value)}
                    className="text-sm p-1.5 border border-border rounded-lg bg-background">
                    <option value="fast">Fast (cheapest)</option>
                    <option value="standard">Standard</option>
                    <option value="premium">Premium (most capable)</option>
                  </select>
                </div>

                {/* Skills list */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Skills: {agent.skills.join(', ')}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
