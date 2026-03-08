import React, { useState, useCallback, useEffect } from 'react';
import { Play, Clock, AlertTriangle, CheckCircle, XCircle, Activity } from 'lucide-react';

const API_BASE = '/api/v1/deployment-manager';

interface PipelineStatus {
  capabilityName: string;
  topology: string;
  adapterHealthy: boolean;
  deploymentStatus: string;
  healthStatus: string;
  endpointUrl: string | null;
  orchestratorSecret?: string;
}

interface InvokeResult {
  status: number;
  statusText: string;
  responseTimeMs: number;
  body: unknown;
}

interface InferencePlaygroundProps {
  deploymentId: string;
  endpointUrl?: string;
}

const DEFAULT_INFERENCE_BODY = JSON.stringify({
  input: {
    prompt: "A beautiful sunset over mountains",
  },
}, null, 2);

export const InferencePlayground: React.FC<InferencePlaygroundProps> = ({ deploymentId, endpointUrl }) => {
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const [loadingPipeline, setLoadingPipeline] = useState(true);
  const [requestBody, setRequestBody] = useState(DEFAULT_INFERENCE_BODY);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<InvokeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPipeline = async () => {
      try {
        const res = await fetch(`${API_BASE}/deployments/${deploymentId}/pipeline-status`);
        const data = await res.json();
        if (data.success) setPipelineStatus(data.data);
      } catch { /* ignore */ }
      setLoadingPipeline(false);
    };
    fetchPipeline();
  }, [deploymentId]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setResult(null);
    setError(null);

    try {
      JSON.parse(requestBody);
    } catch {
      setError('Invalid JSON in request body');
      setRunning(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/deployments/${deploymentId}/invoke?timeout=60000`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });
      const data = await res.json();

      if (data.success) {
        setResult(data.data);
      } else {
        setError(data.error || 'Request failed');
      }
    } catch (err: any) {
      setError(err.message);
    }
    setRunning(false);
  }, [deploymentId, requestBody]);

  if (loadingPipeline) {
    return <p className="text-muted-foreground text-sm">Loading pipeline status...</p>;
  }

  return (
    <div>
      {/* Pipeline status card */}
      {pipelineStatus && (
        <div data-testid="pipeline-status" className="p-4 bg-muted/50 rounded-lg mb-6">
          <h4 className="text-[0.9rem] font-semibold mb-3 text-foreground flex items-center gap-2">
            <Activity size={16} /> Pipeline Status
          </h4>
          <div className="grid grid-cols-2 gap-2 text-[0.8rem]">
            <div>
              <span className="text-muted-foreground/70">Capability:</span>{' '}
              <strong className="text-foreground">{pipelineStatus.capabilityName}</strong>
            </div>
            <div>
              <span className="text-muted-foreground/70">Topology:</span>{' '}
              <strong className="text-foreground">{pipelineStatus.topology}</strong>
            </div>
            <div>
              <span className="text-muted-foreground/70">Adapter:</span>{' '}
              {pipelineStatus.adapterHealthy
                ? <span className="text-green-600 inline-flex items-center gap-1"><CheckCircle size={12} /> Healthy</span>
                : <span className="text-red-600 inline-flex items-center gap-1"><XCircle size={12} /> Unhealthy</span>
              }
            </div>
            <div>
              <span className="text-muted-foreground/70">Secret:</span>{' '}
              <span className="text-muted-foreground">{pipelineStatus.orchestratorSecret || 'N/A'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Endpoint display */}
      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground/70 block mb-1">
          Inference Endpoint
        </label>
        <div className="px-3 py-2 bg-muted/50 border border-border rounded-md font-mono text-[0.8rem] text-foreground break-all">
          {endpointUrl || 'No endpoint URL'}
        </div>
      </div>

      {/* Request body */}
      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground/70 block mb-1">
          Inference Request (JSON)
        </label>
        <textarea
          value={requestBody}
          onChange={(e) => setRequestBody(e.target.value)}
          data-testid="inference-request-body"
          className="w-full min-h-[120px] p-3 font-mono text-xs bg-gray-900 text-gray-200 border border-border rounded-md resize-y leading-relaxed box-border"
        />
      </div>

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={running || !endpointUrl}
        data-testid="run-inference"
        className={`px-5 py-2 border-none rounded-md flex items-center gap-2 text-sm font-medium mb-4 text-white ${
          running ? 'bg-gray-500 cursor-not-allowed' : 'bg-purple-500 cursor-pointer'
        }`}
      >
        <Play size={14} />
        {running ? 'Running Inference...' : 'Run Inference'}
      </button>

      {/* Error */}
      {error && (
        <div className="p-3 mb-4 bg-red-50 border border-red-300 rounded-md text-red-600 flex items-start gap-2 text-[0.8rem]">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Response */}
      {result && (
        <div data-testid="inference-response" className="mb-4">
          <div className="flex gap-4 mb-2 text-[0.8rem]">
            <span
              className={`px-2 py-0.5 rounded font-semibold ${
                result.status >= 200 && result.status < 300
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-50 text-red-600'
              }`}
            >
              {result.status} {result.statusText}
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock size={12} /> {result.responseTimeMs}ms
            </span>
          </div>
          <pre className="bg-gray-900 text-gray-200 font-mono text-[0.7rem] p-3 rounded-md max-h-[300px] overflow-y-auto m-0 leading-relaxed">
            {typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
