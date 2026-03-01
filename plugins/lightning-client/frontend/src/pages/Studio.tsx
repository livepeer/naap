import React, { useState } from 'react';
import { Zap } from 'lucide-react';
import { useGatewayApi } from '../hooks/useGatewayApi';
import { ConnectorSetup } from '../components/ConnectorSetup';
import { HealthBadge } from '../components/HealthBadge';
import { JobManager } from '../components/JobManager';
import { JobStatus } from '../components/JobStatus';
import { EventsStream } from '../components/EventsStream';
import { ControlPanel } from '../components/ControlPanel';
import { WebcamCapture } from '../components/WebcamCapture';

export const Studio: React.FC = () => {
  const api = useGatewayApi();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  return (
    <ConnectorSetup health={api.health}>
      <div className="flex flex-col h-full bg-zinc-950 text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-amber-400" />
            <h1 className="text-sm font-bold">Lightning Client</h1>
            <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
              Gateway Test Harness
            </span>
          </div>
          <HealthBadge health={api.health} />
        </div>

        {/* Main grid */}
        <div className="flex-1 min-h-0 grid grid-cols-3 gap-0">
          {/* Left column: Job Manager + Webcam */}
          <div className="flex flex-col border-r border-zinc-800 overflow-y-auto">
            <div className="p-4 border-b border-zinc-800/50">
              <JobManager
                startJob={api.startJob}
                stopJob={api.stopJob}
                listJobs={api.listJobs}
                onJobStarted={(id) => setSelectedJobId(id)}
                onJobSelected={(id) => setSelectedJobId(id)}
                selectedJobId={selectedJobId}
              />
            </div>
            <div className="p-4">
              <WebcamCapture />
            </div>
          </div>

          {/* Center column: Job Status + Control */}
          <div className="flex flex-col border-r border-zinc-800 overflow-y-auto">
            <div className="p-4 border-b border-zinc-800/50 flex-1">
              <JobStatus jobId={selectedJobId} getJob={api.getJob} />
            </div>
            <div className="p-4 border-t border-zinc-800/50">
              <ControlPanel jobId={selectedJobId} sendControl={api.sendControl} />
            </div>
          </div>

          {/* Right column: Events */}
          <div className="flex flex-col overflow-hidden p-4">
            <EventsStream jobId={selectedJobId} streamEvents={api.streamEvents} />
          </div>
        </div>
      </div>
    </ConnectorSetup>
  );
};
