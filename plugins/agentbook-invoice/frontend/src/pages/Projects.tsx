import React, { useEffect, useState } from 'react';
import { Briefcase, Clock, DollarSign, TrendingUp } from 'lucide-react';

const API = '/api/v1/agentbook-invoice';

export const ProjectsPage: React.FC = () => {
  const [projects, setProjects] = useState<any[]>([]);
  const [profitability, setProfitability] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/projects`).then(r => r.json()),
      fetch(`${API}/project-profitability`).then(r => r.json()),
    ]).then(([proj, prof]) => {
      if (proj.data) setProjects(proj.data);
      if (prof.data) setProfitability(prof.data);
    }).finally(() => setLoading(false));
  }, []);

  const fmt = (c: number) => `$${(c / 100).toFixed(0)}`;

  return (
    <div className="px-4 py-5 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Briefcase className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Projects</h1>
        </div>
      </div>

      {loading && <p className="text-muted-foreground">Loading...</p>}

      <div className="space-y-3">
        {projects.map((p: any) => {
          const prof = profitability.find((pr: any) => pr.projectId === p.id);
          return (
            <div key={p.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium">{p.name}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === 'active' ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground'}`}>{p.status}</span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{p.totalHours || 0}h total</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>{p.hourlyRateCents ? `${fmt(p.hourlyRateCents)}/hr` : 'No rate'}</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>{prof ? fmt(prof.totalRevenueCents) : '$0'} earned</span>
                </div>
              </div>
              {p.budgetHours && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Budget</span>
                    <span>{p.totalHours || 0}h / {p.budgetHours}h</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, ((p.totalHours || 0) / p.budgetHours) * 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {projects.length === 0 && !loading && (
          <div className="text-center py-8 text-muted-foreground">
            <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>No projects yet. Create one to start tracking time!</p>
          </div>
        )}
      </div>
    </div>
  );
};
